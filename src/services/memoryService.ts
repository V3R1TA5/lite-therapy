import { createHash, randomUUID } from 'node:crypto';
import type { ModelProfile } from '../config/appConfig.js';
import type { DatabaseConnection } from '../db/database.js';
import {
  findMemoryByHash,
  insertMemoryCard,
  listMemoryCards,
  MEMORY_KINDS,
  MEMORY_SENSITIVITIES,
  type MemoryCardRecord,
  type MemoryKind,
  type MemorySensitivity,
  markMemoryRecalled,
  recordMemoryRecall,
  searchMemoryCards,
  updateMemoryEmbedding,
} from '../db/repositories/memoryRepository.js';
import { listMessages } from '../db/repositories/messageRepository.js';
import type { ChatProvider } from '../providers/types.js';

const PROMPT_VERSION = 'memory-v1';

const SYSTEM_PROMPT = [
  '你从一次心理咨询会谈中提取可复用的记忆卡。只输出 JSON 数组，不要 Markdown。',
  '最多 8 条。每条字段：kind、text、source_message_ids、confidence、sensitivity、tags。',
  'kind 只能是：fact、theme、relationship、preference、risk_resource、unfinished。',
  'text 一句话，尽量保留来访者自己的措辞，不超过 200 字。',
  'source_message_ids 必须是原文中出现过的消息 ID，至少一个。',
  'confidence 是 0 到 1；sensitivity 只能是 normal、sensitive、restricted；tags 最多 6 个。',
  '不写诊断、不写人格定论、不写“来访者就是……”，不写自伤或自杀的方法细节。',
  '没有可靠来源就不提取；宁可少，不要编造。',
].join('\n');

const DIAGNOSTIC_PATTERN = /(诊断为|患有|人格障碍|抑郁症|焦虑症|双相|精神分裂|来访者就是|你就是)/;
const METHOD_PATTERN = /(自杀方法|怎么自杀|割腕|过量服药|烧炭|跳楼)/;

export interface MemoryServiceOptions {
  db: DatabaseConnection;
  provider?: ChatProvider;
  profile?: ModelProfile;
  apiKey?: string;
  embeddingProvider?: ChatProvider;
  embeddingProfile?: ModelProfile;
  embeddingApiKey?: string | null;
  now?: () => Date;
  newId?: () => string;
  timeoutMs?: number;
  embeddingModel?: string;
}

export interface ExtractedMemory {
  kind: MemoryKind;
  text: string;
  sourceMessageIds: string[];
  confidence: number;
  sensitivity: MemorySensitivity;
  tags: string[];
}

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：,.!?;:"'“”‘’（）()【】[\]]/g, '');
}

export function memoryTextHash(text: string): string {
  return createHash('sha256').update(normalizeText(text)).digest('hex');
}

function trigrams(text: string): Set<string> {
  const normalized = normalizeText(text);
  const grams = new Set<string>();
  for (let index = 0; index + 3 <= normalized.length; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}

export interface MemoryRecallScoreInput {
  coverage: number;
  rank: number;
  confidence: number;
  ageDays: number;
  recallCount: number;
  semantic?: number;
}

/**
 * 召回是关键词近似，不是语义理解。覆盖率只看卡片文本被当前查询覆盖多少，
 * 避免长助手回复把短卡片冲淡；重复引用过多会轻微降权。
 */
export function memoryRecallScore(input: MemoryRecallScoreInput): number {
  const keyword = Math.max(0.2, 1 - input.rank / 20);
  const freshness = Math.exp(-Math.max(0, input.ageDays) / 90);
  const repetition = 1 - Math.min(0.2, input.recallCount * 0.02);
  const lexical =
    0.4 * Math.min(1, Math.max(0, input.coverage)) +
    0.25 * keyword +
    0.2 * Math.min(1, Math.max(0, input.confidence)) +
    0.1 * freshness +
    0.05 * repetition;
  if (input.semantic === undefined) {
    return lexical;
  }
  return 0.7 * lexical + 0.3 * Math.min(1, Math.max(0, input.semantic));
}

function similarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) {
      intersection += 1;
    }
  }
  return intersection / (a.size + b.size - intersection);
}

function cosine(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function extractJsonArray(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '');
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start < 0 || end <= start) {
    throw new Error('记忆提取没有返回 JSON 数组。');
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

/**
 * 提取与召回都只使用本机数据库；召回先做 FTS5 关键词，向量留到后续。
 * 敏感/受限条目默认不进入召回。
 */
export class MemoryService {
  private readonly db: DatabaseConnection;
  private readonly provider?: ChatProvider;
  private readonly profile?: ModelProfile;
  private readonly apiKey?: string;
  private readonly embeddingProvider?: ChatProvider;
  private readonly embeddingProfile?: ModelProfile;
  private readonly embeddingApiKey?: string | null;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly timeoutMs: number;
  private readonly embeddingModel: string;

  constructor(options: MemoryServiceOptions) {
    this.db = options.db;
    this.provider = options.provider;
    this.profile = options.profile;
    this.apiKey = options.apiKey;
    this.embeddingProvider = options.embeddingProvider;
    this.embeddingProfile = options.embeddingProfile;
    this.embeddingApiKey = options.embeddingApiKey;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => randomUUID());
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.embeddingModel = options.embeddingModel?.trim() ?? '';
  }

  private embeddingRuntime(): { provider: ChatProvider; profile: ModelProfile } | null {
    const provider = this.embeddingProvider ?? this.provider;
    const profile = this.embeddingProfile ?? this.profile;
    if (
      this.embeddingModel.length === 0 ||
      provider?.embed === undefined ||
      profile === undefined
    ) {
      return null;
    }
    return { provider, profile };
  }

  private async embedTexts(input: string[]): Promise<number[][]> {
    const runtime = this.embeddingRuntime();
    if (runtime === null) {
      throw new Error('没有配置向量模型。');
    }
    const apiKey =
      this.embeddingApiKey === undefined
        ? this.apiKey
        : this.embeddingApiKey === null
          ? undefined
          : this.embeddingApiKey;
    return await runtime.provider.embed!({
      profile: runtime.profile,
      model: this.embeddingModel,
      input,
      ...(apiKey !== undefined ? { apiKey } : {}),
      timeoutMs: this.timeoutMs,
    });
  }

  async extract(sessionId: string): Promise<MemoryCardRecord[]> {
    if (this.provider === undefined || this.profile === undefined) {
      throw new Error('没有配置提取模型。');
    }
    const messages = listMessages(this.db, sessionId).filter(
      (message) =>
        (message.role === 'user' || message.role === 'assistant') &&
        message.content.trim().length > 0,
    );
    const knownIds = new Set(messages.map((message) => message.id));
    const transcript = messages
      .map(
        (message) =>
          '[' +
          message.id +
          '] [' +
          (message.role === 'user' ? '来访者' : '知微') +
          ']\n' +
          message.content,
      )
      .join('\n\n');

    let output = '';
    for await (const event of this.provider.stream({
      profile: this.profile,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
      ...(this.apiKey !== undefined ? { apiKey: this.apiKey } : {}),
      temperature: 0.1,
      maxTokens: 3000,
      timeoutMs: this.timeoutMs,
    })) {
      if (event.type === 'delta') {
        output += event.text;
      }
    }

    const raw = extractJsonArray(output);
    if (!Array.isArray(raw)) {
      throw new Error('记忆提取结果不是数组。');
    }
    const pending: MemoryCardRecord[] = [];
    for (const item of raw.slice(0, 8)) {
      const parsed = this.validate(item, knownIds);
      if (parsed === null) {
        continue;
      }
      const hash = memoryTextHash(parsed.text);
      if (findMemoryByHash(this.db, hash) !== null) {
        continue;
      }
      const uncertain = this.hasConflict(parsed.text, hash);
      const card: MemoryCardRecord = {
        id: this.newId(),
        kind: parsed.kind,
        text: parsed.text,
        textHash: hash,
        sourceSessionId: sessionId,
        sourceMessageIds: parsed.sourceMessageIds,
        confidence: parsed.confidence,
        sensitivity: parsed.sensitivity,
        tags: parsed.tags,
        status: 'active',
        uncertain,
        embedding: null,
        model: this.profile.model,
        promptVersion: PROMPT_VERSION,
        createdAt: this.now().toISOString(),
        lastRecalledAt: null,
        recallCount: 0,
      };
      pending.push(card);
    }

    if (pending.length > 0 && this.embeddingRuntime() !== null) {
      try {
        const embeddable = pending.filter((card) => card.sensitivity === 'normal');
        const vectors = await this.embedTexts(embeddable.map((card) => card.text));
        if (vectors.length === embeddable.length) {
          embeddable.forEach((card, index) => {
            card.embedding = vectors[index] ?? null;
          });
        }
      } catch {
        // 向量失败不阻塞记忆落库；卡片仍可通过 FTS 召回。
      }
    }

    for (const card of pending) {
      insertMemoryCard(this.db, {
        id: card.id,
        kind: card.kind,
        text: card.text,
        textHash: card.textHash,
        sourceSessionId: sessionId,
        sourceMessageIds: card.sourceMessageIds,
        confidence: card.confidence,
        sensitivity: card.sensitivity,
        tags: card.tags,
        uncertain: card.uncertain,
        embedding: card.embedding,
        model: card.model,
        promptVersion: PROMPT_VERSION,
        createdAt: card.createdAt,
      });
    }
    return pending;
  }

  async backfillEmbeddings(limit = 50): Promise<number> {
    if (this.embeddingRuntime() === null) {
      return 0;
    }
    const cards = listMemoryCards(this.db, { status: 'active', limit: 200 })
      .filter((card) => card.embedding === null && card.sensitivity === 'normal')
      .slice(0, Math.max(1, limit));
    if (cards.length === 0) {
      return 0;
    }
    const vectors = await this.embedTexts(cards.map((card) => card.text));
    if (vectors.length !== cards.length) {
      throw new Error('向量数量与记忆数量不一致。');
    }
    cards.forEach((card, index) => {
      const vector = vectors[index];
      if (vector !== undefined) {
        updateMemoryEmbedding(this.db, card.id, vector);
        card.embedding = vector;
      }
    });
    return cards.length;
  }

  async recall(
    sessionId: string,
    query: string,
    messageId: string | null,
    limit = 5,
    options: { includeSensitive?: boolean } = {},
  ): Promise<MemoryCardRecord[]> {
    const allowed = (card: MemoryCardRecord): boolean =>
      (card.sensitivity === 'normal' ||
        (options.includeSensitive === true && card.sensitivity === 'sensitive')) &&
      card.status === 'active' &&
      !card.uncertain;
    const candidates = searchMemoryCards(this.db, query, 20).filter(allowed);
    const rankById = new Map(candidates.map((card, index) => [card.id, index]));
    let queryVector: number[] | null = null;
    let usedEmbedding = false;

    if (this.embeddingRuntime() !== null) {
      try {
        const vectors = await this.embedTexts([query.slice(-6000)]);
        queryVector = vectors[0] ?? null;
      } catch {
        queryVector = null;
      }
    }

    let pool = candidates;
    if (queryVector !== null) {
      usedEmbedding = true;
      const merged = new Map(candidates.map((card) => [card.id, card]));
      for (const card of listMemoryCards(this.db, { status: 'active', limit: 200 })) {
        if (allowed(card) && card.embedding !== null) {
          merged.set(card.id, card);
        }
      }
      pool = [...merged.values()];
    }

    const now = this.now().getTime();
    const queryGrams = trigrams(query);
    const scored = pool.map((card) => {
      const ageDays = Math.max(0, (now - Date.parse(card.createdAt)) / (24 * 60 * 60 * 1000));
      const cardGrams = trigrams(card.text);
      let overlap = 0;
      for (const gram of cardGrams) {
        if (queryGrams.has(gram)) {
          overlap += 1;
        }
      }
      const coverage = cardGrams.size === 0 ? 0 : overlap / cardGrams.size;
      const semantic =
        queryVector !== null && card.embedding !== null
          ? (cosine(queryVector, card.embedding) + 1) / 2
          : undefined;
      const score = memoryRecallScore({
        coverage,
        rank: rankById.get(card.id) ?? 20,
        confidence: card.confidence,
        ageDays,
        recallCount: card.recallCount,
        ...(semantic !== undefined ? { semantic } : {}),
      });
      return { card, score, coverage };
    });
    scored.sort((left, right) => right.score - left.score);
    const picked = scored.slice(0, limit);
    for (const { card, score } of picked) {
      markMemoryRecalled(this.db, card.id, this.now().toISOString());
      recordMemoryRecall(this.db, {
        id: this.newId(),
        sessionId,
        messageId,
        memoryId: card.id,
        score,
        reason: usedEmbedding ? 'fts5+coverage+embedding' : 'fts5+coverage',
        createdAt: this.now().toISOString(),
      });
    }
    return picked.map(({ card }) => card);
  }

  private hasConflict(text: string, hash: string): boolean {
    const candidates = searchMemoryCards(this.db, text, 20);
    return candidates.some(
      (card) =>
        card.textHash !== hash && card.status === 'active' && similarity(card.text, text) >= 0.55,
    );
  }

  private validate(input: unknown, knownIds: Set<string>): ExtractedMemory | null {
    if (input === null || typeof input !== 'object') {
      return null;
    }
    const value = input as Record<string, unknown>;
    const kind = value.kind;
    const text = typeof value.text === 'string' ? value.text.trim() : '';
    const sensitivity = value.sensitivity;
    const confidence = value.confidence;
    const sourceIds = value.source_message_ids;
    if (
      typeof kind !== 'string' ||
      !MEMORY_KINDS.includes(kind as MemoryKind) ||
      text.length === 0 ||
      text.length > 200 ||
      DIAGNOSTIC_PATTERN.test(text) ||
      METHOD_PATTERN.test(text) ||
      typeof sensitivity !== 'string' ||
      !MEMORY_SENSITIVITIES.includes(sensitivity as MemorySensitivity) ||
      typeof confidence !== 'number' ||
      confidence < 0 ||
      confidence > 1 ||
      !Array.isArray(sourceIds)
    ) {
      return null;
    }
    const ids = sourceIds.filter((id): id is string => typeof id === 'string' && knownIds.has(id));
    if (ids.length === 0) {
      return null;
    }
    const tags = Array.isArray(value.tags)
      ? value.tags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim().slice(0, 20))
          .filter((tag) => tag.length > 0)
          .slice(0, 6)
      : [];
    return {
      kind: kind as MemoryKind,
      text,
      sourceMessageIds: [...new Set(ids)],
      confidence,
      sensitivity: sensitivity as MemorySensitivity,
      tags,
    };
  }
}
