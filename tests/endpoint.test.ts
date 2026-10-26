import { describe, expect, it } from 'vitest';
import { EndpointError, joinEndpoint, normalizeBaseUrl } from '../src/core/endpoint.js';

describe('endpoint', () => {
  it('normalizes trailing slashes and keeps the path', () => {
    expect(normalizeBaseUrl(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('https://api.example.com')).toBe('https://api.example.com');
  });

  it('allows HTTP only for local hosts', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1');
    expect(normalizeBaseUrl('http://localhost:8080/v1')).toBe('http://localhost:8080/v1');
    expect(() => normalizeBaseUrl('http://api.example.com/v1')).toThrow(EndpointError);
  });

  it('rejects credentials, query strings and unsupported protocols', () => {
    expect(() => normalizeBaseUrl('https://user:pass@example.com/v1')).toThrow(EndpointError);
    expect(() => normalizeBaseUrl('https://example.com/v1?key=x')).toThrow(EndpointError);
    expect(() => normalizeBaseUrl('file:///tmp/model')).toThrow(EndpointError);
  });

  it('joins endpoint paths without duplicate slashes', () => {
    expect(joinEndpoint('https://api.example.com/v1/', '/models')).toBe(
      'https://api.example.com/v1/models',
    );
  });
});
