import { randomUUID } from 'node:crypto';
import type { RiskClassifier } from '../core/safety/classifier.js';
import { type RuleMatch, scanRiskText } from '../core/safety/rules.js';
import {
  maxRiskLevel,
  type RiskCategory,
  type RiskContext,
  type RiskLevel,
} from '../core/safety/types.js';
import type { DatabaseConnection } from '../db/database.js';
import { listMessages, updateMessageRiskLevel } from '../db/repositories/messageRepository.js';
import { recordRiskEvent } from '../db/repositories/riskRepository.js';
import { getSession, setSessionRiskState } from '../db/repositories/sessionRepository.js';
import { SessionError } from './sessionService.js';

export interface SafetyEvaluationInput {
  sessionId: string;
  messageId: string;
  text: string;
}

export type SafetyDetector = 'none' | 'rule' | 'model' | 'rule+model' | 'rule-fallback';

export interface SafetyEvaluation {
  level: RiskLevel;
  detector: SafetyDetector;
  category?: RiskCategory;
  context?: RiskContext;
  contexts?: RiskContext[];
  ambiguous: boolean;
  classifierFailed: boolean;
  ruleCount: number;
  confidence?: number;
}

export interface SafetyEvaluator {
  evaluate(input: SafetyEvaluationInput): Promise<SafetyEvaluation>;
}

export interface SafetyServiceOptions {
  db: DatabaseConnection;
  classifier?: RiskClassifier;
  now?: () => Date;
  newId?: () => string;
}

function normalizeRiskLevel(value: string): RiskLevel {
  return value === 'concern' || value === 'imminent' ? value : 'none';
}

function highestMatch(matches: RuleMatch[]): RuleMatch | undefined {
  const order = { none: 0, concern: 1, imminent: 2 } as const;
  return matches
    .filter((match) => !match.suppressed)
    .sort((left, right) => order[right.level] - order[left.level])[0];
}

/**
 * 安全评估顺序：本地规则 → 需要时模型复核 → 跨轮升级 → 落库。
 * 风险原文不写入 risk_events；只记录规则 ID、语境与置信度等元数据。
 */
export class SafetyService implements SafetyEvaluator {
  private readonly db: DatabaseConnection;
  private readonly classifier?: RiskClassifier;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: SafetyServiceOptions) {
    this.db = options.db;
    this.classifier = options.classifier;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => randomUUID());
  }

  async evaluate(input: SafetyEvaluationInput): Promise<SafetyEvaluation> {
    const session = getSession(this.db, input.sessionId);
    if (session === null) {
      throw new SessionError('SESSION_NOT_FOUND', '会谈不存在。');
    }
    const prior = normalizeRiskLevel(session.riskState);
    const scan = scanRiskText(input.text);
    const ruleMatch = highestMatch(scan.matches);

    let level: RiskLevel = scan.level;
    let detector: SafetyDetector = scan.level === 'none' ? 'none' : 'rule';
    let category: RiskCategory | undefined = ruleMatch?.category;
    let context: RiskContext | undefined = ruleMatch?.context;
    let confidence: number | undefined;
    let classifierFailed = false;

    if (scan.signal && this.classifier !== undefined) {
      const result = await this.classifier.classify({
        recentUserMessages: this.recentUserMessages(input.sessionId, input.messageId),
        currentMessage: input.text,
      });
      if (result.ok && result.level !== undefined) {
        level = maxRiskLevel(level, result.level);
        if (result.category !== undefined) {
          category = result.category;
        }
        if (result.context !== undefined) {
          context = result.context;
        }
        if (result.confidence !== undefined) {
          confidence = result.confidence;
        }
        detector =
          scan.level !== 'none' && result.level !== 'none'
            ? 'rule+model'
            : scan.level !== 'none'
              ? 'rule'
              : result.level !== 'none'
                ? 'model'
                : 'none';
      } else {
        classifierFailed = true;
        detector = scan.level !== 'none' ? 'rule-fallback' : 'none';
      }
    } else if (scan.signal && this.classifier === undefined) {
      classifierFailed = true;
      detector = scan.level !== 'none' ? 'rule' : 'none';
    }

    // 跨轮升级：本会谈曾出现 concern，后续模糊表达不降级为 none。
    if (level === 'none' && scan.signal && prior !== 'none') {
      level = 'concern';
      detector = detector === 'none' ? 'rule-fallback' : detector;
    }

    if (scan.signal || level !== 'none') {
      const nowIso = this.now().toISOString();
      updateMessageRiskLevel(this.db, input.messageId, level);
      setSessionRiskState(this.db, input.sessionId, maxRiskLevel(prior, level), nowIso);
      recordRiskEvent(this.db, {
        id: this.newId(),
        sessionId: input.sessionId,
        messageId: input.messageId,
        level,
        detector,
        contextJson: JSON.stringify({
          ruleIds: scan.matches.map((match) => match.ruleId),
          contexts: scan.matches.map((match) => match.context),
          category: category ?? null,
          classifierUsed: this.classifier !== undefined && scan.signal,
          classifierFailed,
          confidence: confidence ?? null,
        }),
        createdAt: nowIso,
      });
    }

    return {
      level,
      detector,
      ...(category !== undefined ? { category } : {}),
      ...(context !== undefined ? { context } : {}),
      ambiguous: scan.ambiguous,
      classifierFailed,
      ruleCount: scan.matches.length,
      contexts: [...new Set(scan.matches.map((match) => match.context))],
      ...(confidence !== undefined ? { confidence } : {}),
    };
  }

  private recentUserMessages(sessionId: string, currentMessageId: string): string[] {
    return listMessages(this.db, sessionId)
      .filter((message) => message.role === 'user' && message.id !== currentMessageId)
      .slice(-4)
      .map((message) => message.content);
  }
}

export function createNoopSafetyEvaluation(): SafetyEvaluation {
  return {
    level: 'none',
    detector: 'none',
    ambiguous: false,
    classifierFailed: false,
    ruleCount: 0,
  };
}
