import type { ModelProfile } from '../config/appConfig.js';
import { M2_SYSTEM_PROMPT } from '../core/counseling/systemPrompt.js';
import type { RiskLevel } from '../core/safety/types.js';
import { estimateTokens } from '../core/tokens.js';
import type { DatabaseConnection } from '../db/database.js';
import {
  deleteMessage,
  getLastMessage,
  getMessage,
  insertMessage,
  type MessageRecord,
  type MessageStatus,
  updateMessageContent,
  updateMessageMeta,
} from '../db/repositories/messageRepository.js';
import { recordModelUsage } from '../db/repositories/modelUsageRepository.js';
import { touchSession } from '../db/repositories/sessionRepository.js';
import { type PromptSnapshot, renderFrozenPrompt, renderLivePrompt } from '../prompts/loader.js';
import type { ChatMessage, ChatProvider } from '../providers/types.js';
import { type ContextBudgets, ContextService } from './contextService.js';
import { MemoryService } from './memoryService.js';
import type { SafetyEvaluation, SafetyEvaluator } from './safetyService.js';
import { SessionError, type SessionService } from './sessionService.js';

export type ChatServiceErrorCode = 'BUSY' | 'NO_USER_MESSAGE';

export class ChatServiceError extends Error {
  readonly code: ChatServiceErrorCode;

  constructor(code: ChatServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ChatServiceError';
    this.code = code;
  }
}

export interface ChatCallbacks {
  onUserMessage?: (message: MessageRecord) => void;
  onAssistantStart?: (message: MessageRecord) => void;
  onDelta?: (text: string, accumulated: string) => void;
  onDone?: (message: MessageRecord) => void;
  onAborted?: (message: MessageRecord) => void;
  onError?: (error: string, message: MessageRecord | null) => void;
  onRisk?: (evaluation: SafetyEvaluation) => void;
}

export type ChatResultStatus = 'done' | 'aborted' | 'error';

export interface ChatResult {
  status: ChatResultStatus;
  message: MessageRecord | null;
  error?: string;
}

export interface ChatServiceOptions {
  db: DatabaseConnection;
  sessions: SessionService;
  profile: ModelProfile;
  provider: ChatProvider;
  apiKey?: string;
  safety?: SafetyEvaluator;
  systemPrompt?: string;
  promptSnapshot?: PromptSnapshot;
  includeLiveLayers?: boolean;
  displayName?: string;
  profileText?: string;
  memoText?: string;
  memoryEnabled?: boolean;
  includeSensitiveMemory?: boolean;
  embeddingModel?: string;
  embeddingProvider?: ChatProvider;
  embeddingProfile?: ModelProfile;
  embeddingApiKey?: string | null;
  contextBudgets?: Partial<ContextBudgets>;
  contextService?: ContextService;
  memoryService?: MemoryService;
  maxHistoryMessages?: number;
  flushIntervalMs?: number;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  now?: () => Date;
  newId?: () => string;
}

interface Usage {
  promptTokens?: number;
  completionTokens?: number;
}

function emit<T extends unknown[]>(callback: ((...args: T) => void) | undefined, ...args: T): void {
  if (callback === undefined) {
    return;
  }
  try {
    callback(...args);
  } catch {
    // UI 回调不应影响消息落库。
  }
}

function readMessageSafely(db: DatabaseConnection, id: string): MessageRecord | null {
  try {
    return getMessage(db, id);
  } catch {
    // 锁定或退出会先关闭数据库；界面已经收到流式内容，稍后启动可再恢复。
    return null;
  }
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 300);
  }
  return '生成回复时出错。';
}

export class ChatService {
  private readonly db: DatabaseConnection;
  private readonly sessions: SessionService;
  private readonly profile: ModelProfile;
  private readonly provider: ChatProvider;
  private readonly apiKey?: string;
  private readonly safety?: SafetyEvaluator;
  private readonly systemPrompt: string;
  private readonly profileText?: string;
  private readonly memoText?: string;
  private readonly memoryEnabled: boolean;
  private readonly includeSensitiveMemory: boolean;
  private readonly includeLiveLayers: boolean;
  private readonly contextService: ContextService;
  private readonly memoryService: MemoryService;
  private readonly flushIntervalMs: number;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly newId: () => string;

  private controller: AbortController | null = null;
  private streaming = false;
  private busy = false;
  private idleWaiters: Array<() => void> = [];

  constructor(options: ChatServiceOptions) {
    this.db = options.db;
    this.sessions = options.sessions;
    this.profile = options.profile;
    this.provider = options.provider;
    this.apiKey = options.apiKey;
    this.safety = options.safety;
    this.systemPrompt =
      options.systemPrompt ??
      (options.promptSnapshot !== undefined
        ? renderFrozenPrompt(options.promptSnapshot)
        : M2_SYSTEM_PROMPT);
    const displayName = options.displayName?.trim() ?? '';
    this.profileText =
      options.profileText ??
      (displayName.length > 0
        ? '来访者自述（只作为背景，不是事实）：\n称呼：' + displayName
        : undefined);
    this.memoText = options.memoText;
    this.memoryEnabled = options.memoryEnabled ?? true;
    this.includeSensitiveMemory = options.includeSensitiveMemory ?? false;
    this.includeLiveLayers = options.includeLiveLayers ?? true;
    this.flushIntervalMs = options.flushIntervalMs ?? 500;
    this.temperature =
      options.temperature ?? options.promptSnapshot?.modelContract.temperature ?? 0.7;
    this.maxTokens = options.maxTokens ?? options.promptSnapshot?.modelContract.maxTokens ?? 2048;
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.memoryService =
      options.memoryService ??
      new MemoryService({
        db: options.db,
        provider: options.provider,
        profile: options.profile,
        ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
        ...(options.embeddingModel !== undefined ? { embeddingModel: options.embeddingModel } : {}),
        ...(options.embeddingProvider !== undefined
          ? { embeddingProvider: options.embeddingProvider }
          : {}),
        ...(options.embeddingProfile !== undefined
          ? { embeddingProfile: options.embeddingProfile }
          : {}),
        ...(options.embeddingApiKey !== undefined
          ? { embeddingApiKey: options.embeddingApiKey }
          : {}),
        now: this.now,
        newId: this.newId,
      });
    this.contextService =
      options.contextService ??
      new ContextService({
        db: options.db,
        sessions: options.sessions,
        profile: options.profile,
        provider: options.provider,
        ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
        ...(options.contextBudgets !== undefined ? { budgets: options.contextBudgets } : {}),
        ...(options.maxHistoryMessages !== undefined
          ? { maxHistoryMessages: options.maxHistoryMessages }
          : {}),
        now: this.now,
        newId: this.newId,
      });
  }

  get isStreaming(): boolean {
    return this.streaming || this.busy;
  }

  private buildSystemPrompt(level: RiskLevel): string {
    let prompt = this.systemPrompt;
    if (this.includeLiveLayers) {
      prompt += '\n\n' + renderLivePrompt(level);
    }
    return prompt;
  }

  abort(): void {
    this.controller?.abort();
  }

  /** 锁定或退出前等待正在生成的回复收尾并落库。 */
  whenIdle(): Promise<void> {
    if (!this.streaming && !this.busy) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private finishActivity(): void {
    if (this.streaming || this.busy) {
      return;
    }
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }

  async send(sessionId: string, text: string, callbacks: ChatCallbacks = {}): Promise<ChatResult> {
    if (this.busy) {
      throw new ChatServiceError('BUSY', '上一条回复还在生成。');
    }
    this.busy = true;
    try {
      const userMessage = this.sessions.appendUserMessage(sessionId, text);
      emit(callbacks.onUserMessage, userMessage);
      const riskLevel = await this.evaluateSafety(sessionId, userMessage, callbacks);
      return await this.generate(sessionId, callbacks, riskLevel);
    } finally {
      this.busy = false;
      this.finishActivity();
    }
  }

  async retryLast(sessionId: string, callbacks: ChatCallbacks = {}): Promise<ChatResult> {
    if (this.busy) {
      throw new ChatServiceError('BUSY', '上一条回复还在生成。');
    }
    this.busy = true;
    try {
      return await this.retryLastInternal(sessionId, callbacks);
    } finally {
      this.busy = false;
      this.finishActivity();
    }
  }

  private async retryLastInternal(
    sessionId: string,
    callbacks: ChatCallbacks,
  ): Promise<ChatResult> {
    if (this.sessions.countUserMessages(sessionId) === 0) {
      throw new ChatServiceError('NO_USER_MESSAGE', '还没有可以重试的用户消息。');
    }
    const last = getLastMessage(this.db, sessionId);
    if (last?.role === 'assistant') {
      deleteMessage(this.db, last.id);
    }
    const lastUser = this.sessions
      .listMessages(sessionId)
      .filter((message) => message.role === 'user')
      .at(-1);
    let riskLevel: RiskLevel = 'none';
    if (lastUser !== undefined) {
      riskLevel =
        lastUser.riskLevel === 'concern' || lastUser.riskLevel === 'imminent'
          ? lastUser.riskLevel
          : 'none';
      if (riskLevel === 'none' && this.safety !== undefined) {
        const evaluation = await this.safety.evaluate({
          sessionId,
          messageId: lastUser.id,
          text: lastUser.content,
        });
        emit(callbacks.onRisk, evaluation);
        riskLevel = evaluation.level;
      }
    }
    return await this.generate(sessionId, callbacks, riskLevel);
  }

  private async evaluateSafety(
    sessionId: string,
    userMessage: MessageRecord,
    callbacks: ChatCallbacks,
  ): Promise<RiskLevel> {
    if (this.safety === undefined) {
      return 'none';
    }
    const evaluation = await this.safety.evaluate({
      sessionId,
      messageId: userMessage.id,
      text: userMessage.content,
    });
    emit(callbacks.onRisk, evaluation);
    return evaluation.level;
  }

  private async generate(
    sessionId: string,
    callbacks: ChatCallbacks,
    riskLevel: RiskLevel = 'none',
  ): Promise<ChatResult> {
    const session = this.sessions.getSession(sessionId);
    if (session === null) {
      throw new SessionError('SESSION_NOT_FOUND', '会谈不存在。');
    }
    if (session.status === 'ended') {
      throw new SessionError('INVALID_SESSION_STATE', '会谈已经结束。');
    }

    const recentMessages = this.sessions.listMessages(sessionId).slice(-2);
    const query = recentMessages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => message.content)
      .join('\n');
    const lastUser = [...recentMessages].reverse().find((message) => message.role === 'user');
    const memories = this.memoryEnabled
      ? await this.memoryService.recall(sessionId, query, lastUser?.id ?? null, 5, {
          includeSensitive: this.includeSensitiveMemory,
        })
      : [];
    const context = await this.contextService.build({
      sessionId,
      systemPrompt: this.buildSystemPrompt(riskLevel),
      ...(this.profileText !== undefined ? { profileText: this.profileText } : {}),
      ...(this.memoText !== undefined ? { memoText: this.memoText } : {}),
      ...(memories.length > 0 ? { memoryCards: memories.map((memory) => memory.text) } : {}),
    });
    const requestMessages: ChatMessage[] = context.messages;

    const createdAt = this.now().toISOString();
    const assistant = insertMessage(this.db, {
      id: this.newId(),
      sessionId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      riskLevel,
      createdAt,
    });

    try {
      this.contextService.persistAudit(context.audit, assistant.id);
    } catch {
      // 审计失败不应阻断当前回复；下一轮可以重新记录。
    }

    const controller = new AbortController();
    this.controller = controller;
    this.streaming = true;
    emit(callbacks.onAssistantStart, assistant);

    let content = '';
    let usage: Usage | undefined;
    let finishReason: string | undefined;
    let lastFlush = this.now().getTime();

    const persist = (status: MessageStatus) => {
      const tokens = estimateTokens(content);
      updateMessageContent(this.db, assistant.id, content, status, tokens);
      updateMessageMeta(
        this.db,
        assistant.id,
        JSON.stringify({
          model: this.profile.model,
          kind: this.profile.kind,
          ...(finishReason !== undefined ? { finishReason } : {}),
          ...(usage !== undefined ? { usage } : {}),
        }),
      );
    };

    try {
      for await (const event of this.provider.stream({
        profile: this.profile,
        messages: requestMessages,
        ...(this.apiKey !== undefined ? { apiKey: this.apiKey } : {}),
        signal: controller.signal,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        timeoutMs: this.timeoutMs,
      })) {
        if (event.type === 'delta') {
          content += event.text;
          emit(callbacks.onDelta, event.text, content);
          const nowMs = this.now().getTime();
          if (nowMs - lastFlush >= this.flushIntervalMs) {
            updateMessageContent(
              this.db,
              assistant.id,
              content,
              'streaming',
              estimateTokens(content),
            );
            lastFlush = nowMs;
          }
        } else if (event.type === 'usage') {
          usage = {
            ...(event.promptTokens !== undefined ? { promptTokens: event.promptTokens } : {}),
            ...(event.completionTokens !== undefined
              ? { completionTokens: event.completionTokens }
              : {}),
          };
        } else if (event.type === 'done') {
          finishReason = event.finishReason;
        }
      }

      persist('complete');
      const completedAt = this.now().toISOString();
      touchSession(this.db, sessionId, completedAt);
      recordModelUsage(this.db, {
        id: this.newId(),
        sessionId,
        task: 'chat',
        model: this.profile.model,
        promptTokens:
          usage?.promptTokens ??
          estimateTokens(requestMessages.map((message) => message.content).join('\n')),
        completionTokens: usage?.completionTokens ?? estimateTokens(content),
        createdAt: completedAt,
      });

      const finalMessage = readMessageSafely(this.db, assistant.id);
      if (finalMessage !== null) {
        emit(callbacks.onDone, finalMessage);
      }
      return { status: 'done', message: finalMessage };
    } catch (error) {
      const aborted =
        controller.signal.aborted ||
        (error instanceof Error && 'code' in error && error.code === 'ABORTED');
      const status: MessageStatus = aborted ? 'interrupted' : 'failed';
      try {
        persist(status);
      } catch {
        // 数据库可能正在关闭；保留已经流到界面的内容，不让清理覆盖原错误。
      }
      const message = readMessageSafely(this.db, assistant.id);
      if (aborted) {
        if (message !== null) {
          emit(callbacks.onAborted, message);
        }
        return { status: 'aborted', message };
      }
      const messageText = safeErrorMessage(error);
      emit(callbacks.onError, messageText, message);
      return { status: 'error', message, error: messageText };
    } finally {
      this.streaming = false;
      this.controller = null;
      this.finishActivity();
    }
  }
}
