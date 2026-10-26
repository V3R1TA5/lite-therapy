import { randomUUID } from 'node:crypto';
import type { ModelProfile } from '../config/appConfig.js';
import { estimateTokens } from '../core/tokens.js';
import type { DatabaseConnection } from '../db/database.js';
import type { MessageRecord } from '../db/repositories/messageRepository.js';
import {
  insertRollingSummary,
  type RollingSummaryRecord,
} from '../db/repositories/summaryRepository.js';
import type { ChatProvider } from '../providers/types.js';

const SYSTEM_PROMPT = [
  '你是会谈记录的滚动摘要器。你的任务是把较早的对话压缩成供后续会谈参考的工作摘要。',
  '保留：反复出现的主题、重要事件、来访者明确说出的感受与需要、未完成的话、来访者纠正过的理解。',
  '不要诊断、不要贴人格标签、不要推断未说出的内容、不要给建议、不要写自伤或自杀的方法细节。',
  '只输出摘要正文，不要 Markdown 标题，不要解释，不超过 600 字。',
].join('\n');

export interface SummaryServiceOptions {
  db: DatabaseConnection;
  provider: ChatProvider;
  profile: ModelProfile;
  apiKey?: string;
  now?: () => Date;
  newId?: () => string;
  timeoutMs?: number;
  chunkTokens?: number;
  maxSummaryChars?: number;
}

export interface UpdateSummaryInput {
  sessionId: string;
  previous: RollingSummaryRecord | null;
  messages: MessageRecord[];
  coveredUntilMessageId: string;
}

function cleanSummary(text: string, maxChars: number): string {
  return text
    .replace(/^\s*```(?:text|markdown)?/i, '')
    .replace(/```\s*$/i, '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, maxChars);
}

/**
 * 只摘要被裁剪的较早消息。失败时返回 null，调用方保留上一版摘要并记录警告，
 * 不因为摘要失败阻断当前会谈。
 */
export class SummaryService {
  private readonly db: DatabaseConnection;
  private readonly provider: ChatProvider;
  private readonly profile: ModelProfile;
  private readonly apiKey?: string;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly timeoutMs: number;
  private readonly chunkTokens: number;
  private readonly maxSummaryChars: number;

  constructor(options: SummaryServiceOptions) {
    this.db = options.db;
    this.provider = options.provider;
    this.profile = options.profile;
    this.apiKey = options.apiKey;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => randomUUID());
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.chunkTokens = options.chunkTokens ?? 6000;
    this.maxSummaryChars = options.maxSummaryChars ?? 1200;
  }

  async update(input: UpdateSummaryInput): Promise<RollingSummaryRecord | null> {
    if (input.messages.length === 0) {
      return input.previous;
    }

    const chunks = this.chunk(input.messages);
    let summary = input.previous?.content ?? '';

    for (const chunk of chunks) {
      const text = chunk
        .map(
          (message) =>
            '[' + (message.role === 'user' ? '来访者' : '知微') + ']\n' + message.content,
        )
        .join('\n\n');
      const previousBlock =
        summary.length > 0 ? '已有摘要（可以修正）：\n' + summary : '已有摘要：无';
      const userContent = [previousBlock, '新增较早对话：\n' + text, '请输出更新后的摘要。'].join(
        '\n\n',
      );

      let output = '';
      try {
        for await (const event of this.provider.stream({
          profile: this.profile,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          ...(this.apiKey !== undefined ? { apiKey: this.apiKey } : {}),
          temperature: 0.2,
          maxTokens: 3000,
          timeoutMs: this.timeoutMs,
        })) {
          if (event.type === 'delta') {
            output += event.text;
          }
        }
      } catch {
        return null;
      }

      const cleaned = cleanSummary(output, this.maxSummaryChars);
      if (cleaned.length === 0) {
        return null;
      }
      summary = cleaned;
    }

    const record: RollingSummaryRecord = {
      id: this.newId(),
      sessionId: input.sessionId,
      coveredUntilMessageId: input.coveredUntilMessageId,
      content: summary,
      model: this.profile.model,
      createdAt: this.now().toISOString(),
    };
    insertRollingSummary(this.db, record);
    return record;
  }

  private chunk(messages: MessageRecord[]): MessageRecord[][] {
    const chunks: MessageRecord[][] = [];
    let current: MessageRecord[] = [];
    let tokens = 0;

    for (const message of messages) {
      const messageTokens =
        message.tokenEstimate > 0 ? message.tokenEstimate : estimateTokens(message.content);
      if (current.length > 0 && tokens + messageTokens > this.chunkTokens) {
        chunks.push(current);
        current = [];
        tokens = 0;
      }
      current.push(message);
      tokens += messageTokens;
    }
    if (current.length > 0) {
      chunks.push(current);
    }
    return chunks;
  }
}
