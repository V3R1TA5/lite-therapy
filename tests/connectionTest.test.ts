import { describe, expect, it } from 'vitest';
import type { ModelProfile } from '../src/config/appConfig.js';
import { testModelConnection } from '../src/providers/connectionTest.js';

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

function jsonResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

describe('testModelConnection', () => {
  it('uses /models first and sends the key without echoing it', async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse('{}', 200);
    }) as typeof fetch;

    const result = await testModelConnection(PROFILE, {
      fetchImpl,
      apiKey: 'sk-secret-value',
    });

    expect(result).toMatchObject({ ok: true, method: 'models' });
    expect(calls[0]?.url).toBe('https://api.example.com/v1/models');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-secret-value');
    expect(result.detail).not.toContain('sk-secret-value');
  });

  it('falls back to a minimal chat request when /models fails', async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return calls.length === 1 ? jsonResponse('nope', 404) : jsonResponse('{}', 200);
    }) as typeof fetch;

    const result = await testModelConnection(PROFILE, { fetchImpl });

    expect(result).toMatchObject({ ok: true, method: 'chat' });
    expect(calls[1]?.url).toBe('https://api.example.com/v1/chat/completions');
    expect(String(calls[1]?.init?.body)).toContain('test-model');
  });

  it('reports both failures without leaking the key', async () => {
    const fetchImpl = (async () => jsonResponse('server error', 500)) as typeof fetch;
    const result = await testModelConnection(PROFILE, {
      fetchImpl,
      apiKey: 'sk-secret-value',
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('HTTP 500');
    expect(result.detail).not.toContain('sk-secret-value');
  });

  it('rejects insecure remote endpoints before making a request', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return jsonResponse('{}', 200);
    }) as typeof fetch;

    const result = await testModelConnection(
      { ...PROFILE, baseUrl: 'http://api.example.com/v1' },
      { fetchImpl },
    );

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('allows local HTTP endpoints for Ollama', async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse('{}', 200);
    }) as typeof fetch;

    const result = await testModelConnection(
      {
        ...PROFILE,
        kind: 'ollama',
        baseUrl: 'http://127.0.0.1:11434/v1',
      },
      { fetchImpl },
    );

    expect(result.ok).toBe(true);
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/v1/models');
  });
});
