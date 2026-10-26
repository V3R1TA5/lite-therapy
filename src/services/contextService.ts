import { randomUUID } from 'node:crypto';
import type { ModelProfile } from '../config/appConfig.js';
import { estimateTokens } from '../core/tokens.js';
import type { DatabaseConnection } from '../db/database.js';
import {
  type ContextAuditEntry,
  insertContextAudit,
} from '../db/repositories/contextAuditRepository.js';
import type { MessageRecord } from '../db/repositories/messageRepository.js';
import {
  getLatestRollingSummary,
  type RollingSummaryRecord,
} from '../db/repositories/summaryRepository.js';
import type { ChatMessage, ChatProvider } from '../providers/types.js';
import type { SessionService } from './sessionService.js';
import { SummaryService } from './summaryService.js';

export interface ContextBudgets {
  modelWindow: number;
  history: number;
  summaryTrigger: number;
  profile: number;
  memo: number;
  memory: number;
  maxUserMessageTokens: number;
  recentTarget: number;
}

export const DEFAULT_CONTEXT_BUDGETS: ContextBudgets = {
  modelWindow: 128_000,
  history: 24_000,
  summaryTrigger: 12_000,
  profile: 800,
  memo: 1500,
  memory: 1200,
  maxUserMessageTokens: 16_000,
  recentTarget: 10_000,
};

export type ContextBudgetErrorCode = 'MESSAGE_TOO_LARGE' | 'NO_MESSAGES';

export class ContextBudgetError extends Error {
  readonly code: ContextBudgetErrorCode;

  constructor(code: ContextBudgetErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ContextBudgetError';
    this.code = code;
  }
}

export interface ContextAudit {
  sessionId: string;
  promptTokens: number;
  historyTokens: number;
  historyMessages: number;
  truncated: boolean;
  summaryUsed: boolean;
  memoUsed: boolean;
  memoryUsed: boolean;
  warnings: string[];
  entries: ContextAuditEntry[];
}

export interface ContextBuildInput {
  sessionId: string;
  systemPrompt: string;
  profileText?: string;
  memoText?: string;
  memoryCards?: string[];
}

export interface ContextBuildResult {
  messages: ChatMessage[];
  audit: ContextAudit;
}

export interface ContextServiceOptions {
  db: DatabaseConnection;
  sessions: SessionService;
  profile: ModelProfile;
  provider: ChatProvider;
  apiKey?: string;
  budgets?: Partial<ContextBudgets>;
  maxHistoryMessages?: number;
  summary?: SummaryService;
  now?: () => Date;
  newId?: () => string;
  summaryTimeoutMs?: number;
}

interface Entry {
  message: MessageRecord;
  tokens: number;
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}

function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) {
    return text;
  }
  let result = '';
  for (const character of text) {
    const next = result + character;
    if (estimateTokens(next) > maxTokens) {
      break;
    }
    result = next;
  }
  return result;
}

/**
 * 组装每轮上下文。历史从最新向前保留，当前用户消息永远完整；
 * 只有确实裁剪且摘要可用时才注入摘要。审计只记录 ID、token 与警告，不记录正文。
 */
export class ContextService {
  private readonly db: DatabaseConnection;
  private readonly sessions: SessionService;
  private readonly budgets: ContextBudgets;
  private readonly maxHistoryMessages: number;
  private readonly summary: SummaryService;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: ContextServiceOptions) {
    this.db = options.db;
    this.sessions = options.sessions;
    this.budgets = { ...DEFAULT_CONTEXT_BUDGETS, ...options.budgets };
    this.maxHistoryMessages = options.maxHistoryMessages ?? 200;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => randomUUID());
    this.summary =
      options.summary ??
      new SummaryService({
        db: options.db,
        provider: options.provider,
        profile: options.profile,
        ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
        now: this.now,
        newId: this.newId,
        ...(options.summaryTimeoutMs !== undefined ? { timeoutMs: options.summaryTimeoutMs } : {}),
      });
  }

  async build(input: ContextBuildInput): Promise<ContextBuildResult> {
    const warnings: string[] = [];
    let all = this.sessions
      .listMessages(input.sessionId)
      .filter(
        (message) =>
          (message.role === 'user' || message.role === 'assistant') &&
          message.content.trim().length > 0,
      );
    if (all.length > this.maxHistoryMessages) {
      all = all.slice(-this.maxHistoryMessages);
      warnings.push('history_capped');
    }
    if (all.length === 0) {
      throw new ContextBudgetError('NO_MESSAGES', '没有可以发送的消息。');
    }

    const entries: Entry[] = all.map((message) => ({
      message,
      tokens: message.tokenEstimate > 0 ? message.tokenEstimate : estimateTokens(message.content),
    }));
    const current = entries[entries.length - 1];
    if (current === undefined) {
      throw new ContextBudgetError('NO_MESSAGES', '没有可以发送的消息。');
    }
    if (current.tokens > this.budgets.maxUserMessageTokens) {
      throw new ContextBudgetError('MESSAGE_TOO_LARGE', '这条消息太长了，请分成几次发送。');
    }

    const totalTokens = entries.reduce((sum, entry) => sum + entry.tokens, 0);
    const needsSummary = totalTokens > this.budgets.summaryTrigger && entries.length > 1;
    let latestSummary: RollingSummaryRecord | null = null;
    let summaryUsed = false;
    let summaryUpdateFailed = false;

    if (needsSummary) {
      latestSummary = getLatestRollingSummary(this.db, input.sessionId);
      const recentStart = this.recentStart(entries, this.budgets.recentTarget);
      const older = entries.slice(0, recentStart);
      const newOlder = this.newOlderMessages(older, latestSummary);
      if (newOlder.length > 0) {
        const lastOlder = older[older.length - 1];
        if (lastOlder !== undefined) {
          const updated = await this.summary.update({
            sessionId: input.sessionId,
            previous: latestSummary,
            messages: newOlder.map((entry) => entry.message),
            coveredUntilMessageId: lastOlder.message.id,
          });
          if (updated !== null) {
            latestSummary = updated;
          } else {
            summaryUpdateFailed = true;
            warnings.push('summary_failed');
          }
        }
      }
      // 有新内容没摘要成功时，不拿旧摘要硬顶；保留更多最近原文。
      summaryUsed = latestSummary !== null && older.length > 0 && !summaryUpdateFailed;
    }

    const summaryTokens = estimateTokens(latestSummary?.content ?? '');
    const minimum = Math.min(1000, this.budgets.recentTarget);
    const historyBudget = summaryUsed
      ? Math.max(minimum, Math.min(this.budgets.recentTarget, this.budgets.history - summaryTokens))
      : this.budgets.history;
    const recentStart = this.recentStart(entries, historyBudget);
    const recent = entries.slice(recentStart);
    const historyTokens = recent.reduce((sum, entry) => sum + entry.tokens, 0);
    const truncated = recentStart > 0 || warnings.includes('history_capped');

    if (truncated && !summaryUsed) {
      warnings.push('history_truncated_without_summary');
    }
    if (truncated) {
      warnings.push('history_truncated');
    }
    if (historyTokens > this.budgets.history) {
      warnings.push('history_over_budget');
    }

    const messages: ChatMessage[] = [{ role: 'system', content: input.systemPrompt }];
    let memoUsed = false;
    let memoryUsed = false;

    if (input.profileText !== undefined && input.profileText.trim().length > 0) {
      if (estimateTokens(input.profileText) > this.budgets.profile) {
        messages.push({
          role: 'system',
          content: truncateToTokens(input.profileText, this.budgets.profile),
        });
        warnings.push('profile_truncated');
      } else {
        messages.push({ role: 'system', content: input.profileText });
      }
    }

    if (summaryUsed && latestSummary !== null) {
      messages.push({
        role: 'system',
        content:
          '以下是本次会谈较早部分的滚动摘要。它是工作假设，不是事实；当前表达优先。\n' +
          latestSummary.content,
      });
    }

    if (input.memoText !== undefined && input.memoText.trim().length > 0) {
      if (estimateTokens(input.memoText) <= this.budgets.memo) {
        messages.push({
          role: 'system',
          content: '本次会谈创建时冻结的备忘录（可能过时，当前表达优先）：\n' + input.memoText,
        });
        memoUsed = true;
      } else {
        warnings.push('memo_over_budget');
      }
    }

    if (input.memoryCards !== undefined && input.memoryCards.length > 0) {
      const text = input.memoryCards.map((card) => '· ' + card).join('\n');
      if (estimateTokens(text) <= this.budgets.memory) {
        messages.push({
          role: 'system',
          content: '可能相关的记忆卡（可能过时，不是事实；不要主动提及）：\n' + text,
        });
        memoryUsed = true;
      } else {
        warnings.push('memory_over_budget');
      }
    }

    for (const entry of recent) {
      messages.push({
        role: entry.message.role === 'user' ? 'user' : 'assistant',
        content: entry.message.content,
      });
    }

    const warningList = uniqueWarnings(warnings);
    const promptTokens =
      estimateTokens(
        messages
          .filter((message) => message.role === 'system')
          .map((message) => message.content)
          .join('\n'),
      ) + historyTokens;
    const included = new Set(recent.map((entry) => entry.message.id));
    const auditEntries: ContextAuditEntry[] = entries.map((entry) => ({
      messageId: entry.message.id,
      role: entry.message.role === 'user' ? 'user' : 'assistant',
      tokens: entry.tokens,
      included: included.has(entry.message.id),
    }));

    return {
      messages,
      audit: {
        sessionId: input.sessionId,
        promptTokens,
        historyTokens,
        historyMessages: recent.length,
        truncated,
        summaryUsed,
        memoUsed,
        memoryUsed,
        warnings: warningList,
        entries: auditEntries,
      },
    };
  }

  persistAudit(audit: ContextAudit, assistantMessageId: string): void {
    insertContextAudit(this.db, {
      id: this.newId(),
      sessionId: audit.sessionId,
      messageId: assistantMessageId,
      promptTokens: audit.promptTokens,
      historyTokens: audit.historyTokens,
      historyMessages: audit.historyMessages,
      truncated: audit.truncated,
      summaryUsed: audit.summaryUsed,
      memoUsed: audit.memoUsed,
      memoryUsed: audit.memoryUsed,
      warnings: audit.warnings,
      entries: audit.entries,
      createdAt: this.now().toISOString(),
    });
  }

  private recentStart(entries: Entry[], targetTokens: number): number {
    const last = entries[entries.length - 1];
    if (last === undefined) {
      return 0;
    }
    let start = entries.length - 1;
    let tokens = last.tokens;
    for (let index = entries.length - 2; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry === undefined || tokens + entry.tokens > targetTokens) {
        break;
      }
      start = index;
      tokens += entry.tokens;
    }
    return start;
  }

  private newOlderMessages(older: Entry[], summary: RollingSummaryRecord | null): Entry[] {
    if (summary === null || summary.coveredUntilMessageId === null) {
      return older;
    }
    const coveredIndex = older.findIndex(
      (entry) => entry.message.id === summary.coveredUntilMessageId,
    );
    if (coveredIndex < 0) {
      return older;
    }
    return older.slice(coveredIndex + 1);
  }
}
