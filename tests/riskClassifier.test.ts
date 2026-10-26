import { describe, expect, it } from 'vitest';
import type { ModelProfile } from '../src/config/appConfig.js';
import { ModelRiskClassifier } from '../src/core/safety/classifier.js';
import { ChatProviderError } from '../src/providers/types.js';
import { ScriptedChatProvider } from './helpers/fakeChatProvider.js';

const PROFILE: ModelProfile = {
  id: 'primary',
  label: 'Fake',
  kind: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  model: 'fake-model',
};

describe('ModelRiskClassifier', () => {
  it('parses strict JSON from the model and sends a non-streaming classification request', async () => {
    const provider = new ScriptedChatProvider([
      [
        {
          type: 'delta',
          text: '{"level":"concern","category":"suicide","evidence_quote":"不想活了","rationale":"有风险线索","confidence":0.8,"context":"self"}',
        },
        { type: 'done' },
      ],
    ]);
    const classifier = new ModelRiskClassifier({ profile: PROFILE, provider });

    const result = await classifier.classify({
      recentUserMessages: ['最近很累'],
      currentMessage: '我有时候真的不想活了',
    });

    expect(result).toMatchObject({
      ok: true,
      level: 'concern',
      category: 'suicide',
      confidence: 0.8,
      context: 'self',
    });
    const request = provider.requests[0];
    expect(request?.messages[0]?.content).toContain('只输出一个 JSON 对象');
    expect(request?.messages[0]?.content).toContain('不要 Markdown');
    expect(request?.maxTokens).toBe(300);
    expect(request?.temperature).toBe(0);
    expect(request?.messages[1]?.content).toContain('最近很累');
    expect(request?.messages[1]?.content).toContain('我有时候真的不想活了');
  });

  it('accepts fenced JSON', async () => {
    const provider = new ScriptedChatProvider([
      [
        {
          type: 'delta',
          text: '```json\n{"level":"none","confidence":0.4,"context":"unclear"}\n```',
        },
        { type: 'done' },
      ],
    ]);
    const classifier = new ModelRiskClassifier({ profile: PROFILE, provider });
    const result = await classifier.classify({
      recentUserMessages: [],
      currentMessage: '今天还好',
    });
    expect(result).toMatchObject({ ok: true, level: 'none', confidence: 0.4 });
  });

  it('fails closed on invalid JSON, provider errors and timeouts', async () => {
    const invalid = new ModelRiskClassifier({
      profile: PROFILE,
      provider: new ScriptedChatProvider([[{ type: 'delta', text: 'not json' }, { type: 'done' }]]),
    });
    expect(await invalid.classify({ recentUserMessages: [], currentMessage: 'x' })).toMatchObject({
      ok: false,
      errorCode: 'PROTOCOL',
    });

    const network = new ModelRiskClassifier({
      profile: PROFILE,
      provider: new ScriptedChatProvider([
        [new ChatProviderError('NETWORK', 'connection refused')],
      ]),
    });
    expect(await network.classify({ recentUserMessages: [], currentMessage: 'x' })).toMatchObject({
      ok: false,
      errorCode: 'NETWORK',
    });

    const timeout = new ModelRiskClassifier({
      profile: PROFILE,
      provider: new ScriptedChatProvider([[new ChatProviderError('TIMEOUT', 'timeout')]]),
    });
    expect(await timeout.classify({ recentUserMessages: [], currentMessage: 'x' })).toMatchObject({
      ok: false,
      errorCode: 'TIMEOUT',
    });
  });
});
