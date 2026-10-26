import { createHash } from 'node:crypto';
import { z } from 'zod';
import { M2_SYSTEM_PROMPT } from '../core/counseling/systemPrompt.js';
import type { RiskLevel } from '../core/safety/types.js';
import { counselorCore } from './counselor/core.js';
import { counselorDialogue } from './counselor/dialogue.js';
import { counselorVoice } from './counselor/voice.js';
import { MODEL_CONTRACT, modelContractLayer } from './model/contract.js';
import { liveEthics } from './shared/ethics.js';
import { liveSafety, riskEmphasis } from './shared/safety.js';
import { sharedValues } from './shared/values.js';

export interface PromptLayer {
  id: string;
  version: string;
  text: string;
}

export interface PromptSnapshotLayer extends PromptLayer {
  sha256: string;
}

export interface ModelContract {
  version: string;
  temperature: number;
  maxTokens: number;
}

export interface PromptSnapshot {
  version: 1;
  locale: 'zh-CN';
  counselorId: 'zhiwei';
  createdAt: string;
  frozen: PromptSnapshotLayer[];
  modelContract: ModelContract;
  livePolicyVersion: string;
  hash: string;
}

export class PromptSnapshotError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PromptSnapshotError';
  }
}

const MODEL_CONTRACT_SCHEMA = z.strictObject({
  version: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive().max(32_000),
});

const snapshotSchema = z.strictObject({
  version: z.literal(1),
  locale: z.literal('zh-CN'),
  counselorId: z.literal('zhiwei'),
  createdAt: z.string().min(1),
  frozen: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        version: z.string().min(1),
        text: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1),
  modelContract: MODEL_CONTRACT_SCHEMA,
  livePolicyVersion: z.string().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const FROZEN_LAYERS: readonly PromptLayer[] = [
  counselorCore,
  sharedValues,
  counselorDialogue,
  counselorVoice,
  modelContractLayer,
];

export const LIVE_POLICY_VERSION = '2026-10-26.1';

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashLayers(layers: readonly PromptLayer[]): string {
  return sha256(
    layers.map((layer) => layer.id + '@' + layer.version + '\n' + layer.text).join('\n\n'),
  );
}

export function buildPromptSnapshot(now: Date = new Date()): PromptSnapshot {
  const frozen = FROZEN_LAYERS.map((layer) => ({
    ...layer,
    sha256: sha256(layer.text),
  }));
  return {
    version: 1,
    locale: 'zh-CN',
    counselorId: 'zhiwei',
    createdAt: now.toISOString(),
    frozen,
    modelContract: { ...MODEL_CONTRACT },
    livePolicyVersion: LIVE_POLICY_VERSION,
    hash: hashLayers(frozen),
  };
}

/**
 * M2 创建的会谈没有快照。首次在 M3 中继续时，把当时的单一系统提示
 * 冻结为 legacy 层，避免把新分层人格静默套到旧会谈上。
 */
export function buildLegacyM2Snapshot(now: Date = new Date()): PromptSnapshot {
  const legacy = {
    id: 'legacy/m2',
    version: 'm2-2026-10-26',
    text: M2_SYSTEM_PROMPT,
  };
  const frozen = [{ ...legacy, sha256: sha256(legacy.text) }];
  return {
    version: 1,
    locale: 'zh-CN',
    counselorId: 'zhiwei',
    createdAt: now.toISOString(),
    frozen,
    modelContract: { ...MODEL_CONTRACT },
    livePolicyVersion: LIVE_POLICY_VERSION,
    hash: hashLayers(frozen),
  };
}

export function parsePromptSnapshot(input: unknown): PromptSnapshot {
  const result = snapshotSchema.safeParse(input);
  if (!result.success) {
    throw new PromptSnapshotError('Prompt 快照格式不正确。', { cause: result.error });
  }
  const snapshot = result.data;
  if (hashLayers(snapshot.frozen) !== snapshot.hash) {
    throw new PromptSnapshotError('Prompt 快照哈希不匹配。');
  }
  for (const layer of snapshot.frozen) {
    if (sha256(layer.text) !== layer.sha256) {
      throw new PromptSnapshotError('Prompt 快照层内容与哈希不匹配。');
    }
  }
  return snapshot;
}

export function serializePromptSnapshot(snapshot: PromptSnapshot): string {
  return JSON.stringify(snapshot);
}

export function renderFrozenPrompt(snapshot: PromptSnapshot): string {
  return snapshot.frozen.map((layer) => layer.text).join('\n\n');
}

export function renderLivePrompt(level: RiskLevel = 'none'): string {
  const parts: string[] = [liveEthics.text, liveSafety.text];
  const emphasis = riskEmphasis(level);
  if (emphasis.length > 0) {
    parts.push(emphasis);
  }
  return parts.join('\n\n');
}

export function buildSystemPrompt(snapshot: PromptSnapshot, level: RiskLevel = 'none'): string {
  return renderFrozenPrompt(snapshot) + '\n\n' + renderLivePrompt(level);
}
