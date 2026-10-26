import { describe, expect, it } from 'vitest';
import {
  buildLegacyM2Snapshot,
  buildPromptSnapshot,
  buildSystemPrompt,
  FROZEN_LAYERS,
  hashLayers,
  parsePromptSnapshot,
  renderFrozenPrompt,
  renderLivePrompt,
  serializePromptSnapshot,
} from '../src/prompts/loader.js';

describe('prompt layers', () => {
  it('freezes the counselor layers and leaves live policy out of the snapshot', () => {
    const snapshot = buildPromptSnapshot(new Date('2026-10-26T10:00:00.000Z'));

    expect(snapshot.frozen.map((layer) => layer.id)).toEqual([
      'counselor/core',
      'shared/values',
      'counselor/dialogue',
      'counselor/voice',
      'model/contract',
    ]);
    expect(snapshot.hash).toHaveLength(64);
    expect(snapshot.hash).toBe(hashLayers(snapshot.frozen));
    expect(snapshot.createdAt).toBe('2026-10-26T10:00:00.000Z');
    expect(snapshot.modelContract.temperature).toBe(0.7);

    const frozen = renderFrozenPrompt(snapshot);
    expect(frozen).toContain('知微');
    expect(frozen).toContain('当前表达优先');
    expect(frozen).not.toContain('本轮伦理要求');
    expect(frozen).not.toContain('本轮安全要求');
  });

  it('round-trips a snapshot and rejects tampering', () => {
    const snapshot = buildPromptSnapshot();
    const parsed = parsePromptSnapshot(JSON.parse(serializePromptSnapshot(snapshot)));
    expect(parsed.hash).toBe(snapshot.hash);

    const tampered = JSON.parse(serializePromptSnapshot(snapshot)) as {
      frozen: Array<{ text: string }>;
    };
    const firstLayer = tampered.frozen[0];
    expect(firstLayer).toBeDefined();
    if (firstLayer !== undefined) {
      firstLayer.text += '被篡改';
    }
    expect(() => parsePromptSnapshot(tampered)).toThrow(/快照/);
  });

  it('renders live ethics and safety, with extra emphasis for risk levels', () => {
    const none = renderLivePrompt('none');
    expect(none).toContain('如实披露 AI 身份');
    expect(none).toContain('不提供任何方法');

    const concern = renderLivePrompt('concern');
    expect(concern).toContain('确认对方此刻是否安全');
    expect(concern.length).toBeGreaterThan(none.length);

    const imminent = renderLivePrompt('imminent');
    expect(imminent).toContain('立即安全');
    expect(imminent).toContain('不能到场');
  });

  it('builds a combined system prompt and a legacy snapshot for M2 sessions', () => {
    const snapshot = buildPromptSnapshot();
    const system = buildSystemPrompt(snapshot, 'concern');
    expect(system).toContain('知微');
    expect(system).toContain('本轮伦理要求');
    expect(system).toContain('确认对方此刻是否安全');

    const legacy = buildLegacyM2Snapshot();
    expect(legacy.frozen).toHaveLength(1);
    expect(legacy.frozen[0]?.id).toBe('legacy/m2');
    expect(renderFrozenPrompt(legacy)).toContain('知微');
    expect(FROZEN_LAYERS).toHaveLength(5);
  });
});
