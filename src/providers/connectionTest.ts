import type { ModelProfile } from '../config/appConfig.js';
import { joinEndpoint, normalizeBaseUrl } from '../core/endpoint.js';

export type ConnectionMethod = 'models' | 'chat' | 'none';

export interface ConnectionTestResult {
  ok: boolean;
  method: ConnectionMethod;
  detail: string;
}

export interface ConnectionTestOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

function safeDetail(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 200);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * 先试 /models（轻量、不产生 token），失败再发最小 chat 请求。
 * 错误信息会回给 UI，因此绝不能包含 API Key。
 */
export async function testModelConnection(
  profile: ModelProfile,
  options: ConnectionTestOptions = {},
): Promise<ConnectionTestResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(profile.baseUrl);
  } catch (error) {
    return {
      ok: false,
      method: 'none',
      detail: error instanceof Error ? error.message : '接口地址不合法。',
    };
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.apiKey && options.apiKey.trim().length > 0) {
    headers.Authorization = 'Bearer ' + options.apiKey.trim();
  }

  let modelsError = '';
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      joinEndpoint(baseUrl, '/models'),
      { method: 'GET', headers },
      timeoutMs,
    );
    if (response.ok) {
      return { ok: true, method: 'models', detail: '已连接，/models 可用。' };
    }
    modelsError = 'HTTP ' + response.status;
  } catch (error) {
    modelsError =
      error instanceof Error && error.name === 'TimeoutError' ? '超时' : safeDetail(String(error));
  }

  let chatError = '';
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      joinEndpoint(baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: profile.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      },
      timeoutMs,
    );
    if (response.ok) {
      return { ok: true, method: 'chat', detail: '已连接，最小对话请求成功。' };
    }
    chatError = 'HTTP ' + response.status;
  } catch (error) {
    chatError =
      error instanceof Error && error.name === 'TimeoutError' ? '超时' : safeDetail(String(error));
  }

  return {
    ok: false,
    method: 'none',
    detail: '/models：' + modelsError + '；/chat/completions：' + chatError,
  };
}
