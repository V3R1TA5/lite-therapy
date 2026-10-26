import { describe, expect, it } from 'vitest';
import type { ModelProfile } from '../src/config/appConfig.js';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import type { ChatStreamEvent } from '../src/providers/types.js';

const PROFILE: ModelProfile = {
  id: 'primary',
  label: 'Test',
  kind: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
};

interface Call {
  url: string;
  init?: RequestInit;
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect(iterable: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe('OpenAICompatibleProvider', () => {
  it('parses SSE deltas split across chunks and reports usage', async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return sseResponse([
        'data: {"choices":[{"delta":{"con',
        'tent":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n',
        'data: [DONE]\n\n',
      ]);
    }) as typeof fetch;

    const provider = new OpenAICompatibleProvider({ fetchImpl });
    const events = await collect(
      provider.stream({
        profile: PROFILE,
        apiKey: 'sk-test-value',
        messages: [
          { role: 'system', content: 'system' },
          { role: 'user', content: '你好' },
        ],
      }),
    );

    expect(events).toEqual([
      { type: 'delta', text: '你' },
      { type: 'delta', text: '好' },
      { type: 'usage', promptTokens: 12, completionTokens: 3 },
      { type: 'done' },
    ]);
    expect(calls[0]?.url).toBe('https://api.example.com/v1/chat/completions');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test-value');
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'test-model',
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    });
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it('accepts a non-streaming JSON response as a fallback', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '完整回复' } }],
          usage: { prompt_tokens: 7, completion_tokens: 4 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    const provider = new OpenAICompatibleProvider({ fetchImpl });
    const events = await collect(
      provider.stream({
        profile: PROFILE,
        messages: [{ role: 'user', content: '你好' }],
      }),
    );

    expect(events).toEqual([
      { type: 'delta', text: '完整回复' },
      { type: 'usage', promptTokens: 7, completionTokens: 4 },
      { type: 'done' },
    ]);
  });

  it('maps authentication failures without echoing the key', async () => {
    const fetchImpl = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch;
    const provider = new OpenAICompatibleProvider({ fetchImpl });

    await expect(
      collect(
        provider.stream({
          profile: PROFILE,
          apiKey: 'sk-secret-value',
          messages: [{ role: 'user', content: 'x' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('maps rate limits and server failures', async () => {
    const rateLimited = new OpenAICompatibleProvider({
      fetchImpl: (async () => new Response('slow down', { status: 429 })) as typeof fetch,
    });
    await expect(
      collect(rateLimited.stream({ profile: PROFILE, messages: [] })),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' });

    const serverError = new OpenAICompatibleProvider({
      fetchImpl: (async () => new Response('boom', { status: 503 })) as typeof fetch,
    });
    await expect(
      collect(serverError.stream({ profile: PROFILE, messages: [] })),
    ).rejects.toMatchObject({ code: 'SERVER' });
  });

  it('rejects malformed SSE data', async () => {
    const provider = new OpenAICompatibleProvider({
      fetchImpl: (async () => sseResponse(['data: {not json}\n\n'])) as typeof fetch,
    });
    await expect(
      collect(provider.stream({ profile: PROFILE, messages: [] })),
    ).rejects.toMatchObject({ code: 'PROTOCOL' });
  });

  it('distinguishes user aborts from timeouts', async () => {
    const hangingFetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as typeof fetch;

    const controller = new AbortController();
    const provider = new OpenAICompatibleProvider({ fetchImpl: hangingFetch });
    const iterator = provider
      .stream({
        profile: PROFILE,
        messages: [],
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });

    const timeoutProvider = new OpenAICompatibleProvider({ fetchImpl: hangingFetch });
    await expect(
      collect(
        timeoutProvider.stream({
          profile: PROFILE,
          messages: [],
          timeoutMs: 20,
        }),
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('requests OpenAI-compatible embeddings and validates vector dimensions', async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          data: [
            { index: 0, embedding: [0.1, 0.2, 0.3] },
            { index: 1, embedding: [0.4, 0.5, 0.6] },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new OpenAICompatibleProvider({ fetchImpl });
    const vectors = await provider.embed({
      profile: PROFILE,
      model: 'embed-model',
      input: ['卡片一', '卡片二'],
    });
    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(calls[0]?.url).toBe('https://api.example.com/v1/embeddings');
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.model).toBe('embed-model');
    expect(body.input).toEqual(['卡片一', '卡片二']);

    const incomplete = new OpenAICompatibleProvider({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch,
    });
    await expect(
      incomplete.embed({ profile: PROFILE, model: 'embed-model', input: ['a', 'b'] }),
    ).rejects.toMatchObject({ code: 'PROTOCOL' });
  });
});
