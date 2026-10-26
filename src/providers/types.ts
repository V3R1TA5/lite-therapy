import type { ModelProfile } from '../config/appConfig.js';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  profile: ModelProfile;
  apiKey?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; promptTokens?: number; completionTokens?: number }
  | { type: 'done'; finishReason?: string };

export interface EmbeddingRequest {
  profile: ModelProfile;
  apiKey?: string;
  model: string;
  input: string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ChatProvider {
  stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
  embed?(request: EmbeddingRequest): Promise<number[][]>;
}

export type ChatProviderErrorCode =
  | 'NETWORK'
  | 'AUTH'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'SERVER'
  | 'HTTP'
  | 'PROTOCOL'
  | 'ABORTED'
  | 'TIMEOUT';

export class ChatProviderError extends Error {
  readonly code: ChatProviderErrorCode;
  readonly status?: number;

  constructor(
    code: ChatProviderErrorCode,
    message: string,
    options: ErrorOptions & { status?: number } = {},
  ) {
    super(message, options);
    this.name = 'ChatProviderError';
    this.code = code;
    this.status = options.status;
  }
}
