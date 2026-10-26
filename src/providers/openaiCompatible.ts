import { joinEndpoint, normalizeBaseUrl } from '../core/endpoint.js';
import {
  type ChatProvider,
  ChatProviderError,
  type ChatRequest,
  type ChatRole,
  type ChatStreamEvent,
  type EmbeddingRequest,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_TOKENS = 2048;

function httpError(status: number): ChatProviderError {
  if (status === 401 || status === 403) {
    return new ChatProviderError('AUTH', '模型服务拒绝认证，请检查 API Key。', { status });
  }
  if (status === 404) {
    return new ChatProviderError('NOT_FOUND', '接口或模型不存在，请检查 base URL 与模型名。', {
      status,
    });
  }
  if (status === 429) {
    return new ChatProviderError('RATE_LIMIT', '模型服务限流，请稍后再试。', { status });
  }
  if (status >= 500) {
    return new ChatProviderError('SERVER', '模型服务暂时不可用（HTTP ' + status + '）。', {
      status,
    });
  }
  return new ChatProviderError('HTTP', '模型请求失败（HTTP ' + status + '）。', { status });
}

function safeText(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 160);
}

interface ParsedData {
  kind: 'delta' | 'usage' | 'finish' | 'error' | 'done';
  text?: string;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
}

function parseDataLine(line: string): ParsedData | null {
  if (!line.startsWith('data:')) {
    return null;
  }
  const data = line.slice(5).trimStart();
  if (data.length === 0) {
    return null;
  }
  if (data === '[DONE]') {
    return { kind: 'done' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    throw new ChatProviderError('PROTOCOL', '模型返回了无法解析的数据流。');
  }
  if (payload === null || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (record.error !== undefined) {
    throw new ChatProviderError('PROTOCOL', '模型服务在数据流中返回了错误。');
  }

  const result: ParsedData = { kind: 'finish' };
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  if (first !== undefined) {
    const delta = first.delta as Record<string, unknown> | undefined;
    const content = delta?.content;
    if (typeof content === 'string' && content.length > 0) {
      result.kind = 'delta';
      result.text = content;
    }
    if (typeof first.finish_reason === 'string' && first.finish_reason.length > 0) {
      result.finishReason = first.finish_reason;
    }
  }

  const usage = record.usage as Record<string, unknown> | undefined;
  if (usage !== undefined) {
    result.kind = result.kind === 'delta' ? 'delta' : 'usage';
    if (result.kind === 'usage') {
      result.promptTokens =
        typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined;
      result.completionTokens =
        typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined;
    }
  }

  return result;
}

function isChatRole(value: unknown): value is ChatRole {
  return value === 'system' || value === 'user' || value === 'assistant';
}

/**
 * OpenAI-compatible /chat/completions 流式实现。Ollama 也走它的兼容端点。
 * 手写 SSE 是因为这里只需要 data 行，且要区分用户停止、超时与协议错误。
 */
export class OpenAICompatibleProvider implements ChatProvider {
  private readonly fetchImpl?: typeof fetch;

  constructor(options: { fetchImpl?: typeof fetch } = {}) {
    this.fetchImpl = options.fetchImpl;
  }

  async embed(request: EmbeddingRequest): Promise<number[][]> {
    const fetchImpl = request.fetchImpl ?? this.fetchImpl ?? fetch;
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(request.profile.baseUrl);
    } catch (error) {
      throw new ChatProviderError(
        'NETWORK',
        error instanceof Error ? error.message : '接口地址不合法。',
        { cause: error },
      );
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (request.apiKey !== undefined && request.apiKey.trim().length > 0) {
      headers.Authorization = 'Bearer ' + request.apiKey.trim();
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(joinEndpoint(baseUrl, '/embeddings'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: request.model, input: request.input }),
        signal: timeoutSignal,
      });
    } catch (error) {
      throw translateFetchError(error, undefined, timeoutSignal);
    }
    if (!response.ok) {
      throw httpError(response.status);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ChatProviderError('PROTOCOL', '向量服务返回了非 JSON 响应。', { cause: error });
    }
    const data =
      payload !== null && typeof payload === 'object' && 'data' in payload
        ? (payload as { data: unknown }).data
        : null;
    if (!Array.isArray(data) || data.length !== request.input.length) {
      throw new ChatProviderError('PROTOCOL', '向量数量与请求不一致。');
    }
    const vectors = data
      .map((item) => {
        if (item === null || typeof item !== 'object' || !('embedding' in item)) {
          return null;
        }
        const embedding = (item as { embedding: unknown }).embedding;
        if (!Array.isArray(embedding) || embedding.length === 0) {
          return null;
        }
        const values = embedding.map((value) => (typeof value === 'number' ? value : Number.NaN));
        if (values.some((value) => !Number.isFinite(value))) {
          return null;
        }
        return values;
      })
      .filter((values): values is number[] => values !== null);
    if (vectors.length !== request.input.length) {
      throw new ChatProviderError('PROTOCOL', '向量内容不完整。');
    }
    const dimension = vectors[0]?.length ?? 0;
    if (vectors.some((values) => values.length !== dimension)) {
      throw new ChatProviderError('PROTOCOL', '向量维度不一致。');
    }
    return vectors;
  }

  async *stream(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const fetchImpl = request.fetchImpl ?? this.fetchImpl ?? fetch;
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(request.profile.baseUrl);
    } catch (error) {
      throw new ChatProviderError(
        'NETWORK',
        error instanceof Error ? error.message : '接口地址不合法。',
        { cause: error },
      );
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal =
      request.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([request.signal, timeoutSignal]);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (request.apiKey !== undefined && request.apiKey.trim().length > 0) {
      headers.Authorization = 'Bearer ' + request.apiKey.trim();
    }

    const body = {
      model: request.profile.model,
      messages: request.messages.map((message) => ({
        role: isChatRole(message.role) ? message.role : 'user',
        content: message.content,
      })),
      stream: true,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    };

    let response: Response;
    try {
      response = await fetchImpl(joinEndpoint(baseUrl, '/chat/completions'), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw translateFetchError(error, request.signal, timeoutSignal);
    }

    if (!response.ok) {
      throw httpError(response.status);
    }
    if (response.body === null) {
      throw new ChatProviderError('PROTOCOL', '模型返回了空响应。');
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      yield* this.readJsonResponse(response, request.signal, timeoutSignal);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason: string | undefined;
    let sawDone = false;

    try {
      while (!sawDone) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const parsed = parseDataLine(line);
          if (parsed === null) {
            continue;
          }
          if (parsed.kind === 'done') {
            sawDone = true;
            break;
          }
          if (parsed.kind === 'delta' && parsed.text !== undefined) {
            yield { type: 'delta', text: parsed.text };
          } else if (parsed.kind === 'usage') {
            yield {
              type: 'usage',
              ...(parsed.promptTokens !== undefined ? { promptTokens: parsed.promptTokens } : {}),
              ...(parsed.completionTokens !== undefined
                ? { completionTokens: parsed.completionTokens }
                : {}),
            };
          }
          if (parsed.finishReason !== undefined) {
            finishReason = parsed.finishReason;
          }
        }
      }

      if (!sawDone && buffer.trim().length > 0) {
        const parsed = parseDataLine(buffer.trim());
        if (parsed?.kind === 'done') {
          sawDone = true;
        } else if (parsed?.kind === 'delta' && parsed.text !== undefined) {
          yield { type: 'delta', text: parsed.text };
        }
      }
    } catch (error) {
      if (error instanceof ChatProviderError) {
        throw error;
      }
      throw translateFetchError(error, request.signal, timeoutSignal);
    } finally {
      try {
        await reader.cancel();
      } catch {
        // 流已关闭或已中止，忽略。
      }
    }

    yield {
      type: 'done',
      ...(finishReason !== undefined ? { finishReason } : {}),
    };
  }

  private async *readJsonResponse(
    response: Response,
    userSignal: AbortSignal | undefined,
    timeoutSignal: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw translateFetchError(error, userSignal, timeoutSignal);
    }
    if (payload === null || typeof payload !== 'object') {
      throw new ChatProviderError('PROTOCOL', '模型返回了无法解析的 JSON。');
    }
    const record = payload as Record<string, unknown>;
    if (record.error !== undefined) {
      throw new ChatProviderError('PROTOCOL', '模型服务返回了错误。');
    }
    const choices = Array.isArray(record.choices) ? record.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === 'string' && content.length > 0) {
      yield { type: 'delta', text: content };
    }
    const usage = record.usage as Record<string, unknown> | undefined;
    if (usage !== undefined) {
      const promptTokens =
        typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined;
      const completionTokens =
        typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined;
      if (promptTokens !== undefined || completionTokens !== undefined) {
        yield {
          type: 'usage',
          ...(promptTokens !== undefined ? { promptTokens } : {}),
          ...(completionTokens !== undefined ? { completionTokens } : {}),
        };
      }
    }
    yield { type: 'done' };
  }
}

function translateFetchError(
  error: unknown,
  userSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): ChatProviderError {
  if (userSignal?.aborted) {
    return new ChatProviderError('ABORTED', '已停止生成。', { cause: error });
  }
  if (timeoutSignal.aborted) {
    return new ChatProviderError('TIMEOUT', '模型请求超时。', { cause: error });
  }
  if (error instanceof ChatProviderError) {
    return error;
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new ChatProviderError('TIMEOUT', '模型请求超时。', { cause: error });
  }
  return new ChatProviderError(
    'NETWORK',
    '无法连接模型服务：' + safeText(error instanceof Error ? error.message : String(error)),
    { cause: error },
  );
}
