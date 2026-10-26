const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export type EndpointErrorCode = 'INVALID_URL' | 'UNSUPPORTED_PROTOCOL' | 'INSECURE_URL';

export class EndpointError extends Error {
  readonly code: EndpointErrorCode;

  constructor(code: EndpointErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EndpointError';
    this.code = code;
  }
}

export function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return LOCAL_HOSTS.has(normalized) || normalized.endsWith('.localhost');
}

/**
 * 归一化用户填写的 base URL。这里同时承担安全校验：
 * 除本机地址外只允许 HTTPS，避免把会谈内容发到明文 HTTP 端点。
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new EndpointError('INVALID_URL', '接口地址不能为空。');
  }
  if (trimmed.length > 300) {
    throw new EndpointError('INVALID_URL', '接口地址过长。');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (error) {
    throw new EndpointError('INVALID_URL', '接口地址不是合法的 URL。', { cause: error });
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new EndpointError('UNSUPPORTED_PROTOCOL', '接口地址只支持 http 或 https。');
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new EndpointError('INVALID_URL', '接口地址里不要包含用户名或密码。');
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new EndpointError('INVALID_URL', '接口地址里不要包含查询参数或片段。');
  }
  if (url.protocol === 'http:' && !isLocalHostname(url.hostname)) {
    throw new EndpointError(
      'INSECURE_URL',
      '只有本机地址（localhost / 127.0.0.1）可以使用 HTTP；其他地址请使用 HTTPS。',
    );
  }

  const path = url.pathname.replace(/\/+$/, '');
  return url.origin + path;
}

export function joinEndpoint(baseUrl: string, path: string): string {
  const suffix = path.startsWith('/') ? path : '/' + path;
  return baseUrl.replace(/\/+$/, '') + suffix;
}
