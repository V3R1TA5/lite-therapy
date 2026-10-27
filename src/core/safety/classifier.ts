import { z } from 'zod';
import type { ModelProfile } from '../../config/appConfig.js';
import type { ChatProvider } from '../../providers/types.js';
import { ChatProviderError } from '../../providers/types.js';
import type { RiskCategory, RiskContext, RiskLevel } from './types.js';

export interface RiskClassifierInput {
  recentUserMessages: string[];
  currentMessage: string;
}

export interface RiskClassifierResult {
  ok: boolean;
  level?: RiskLevel;
  category?: RiskCategory;
  evidenceQuote?: string;
  rationale?: string;
  confidence?: number;
  context?: RiskContext;
  errorCode?: string;
}

export interface RiskClassifier {
  classify(input: RiskClassifierInput): Promise<RiskClassifierResult>;
}

const riskLevelSchema = z.enum(['none', 'concern', 'imminent']);
const riskCategorySchema = z.enum([
  'suicide',
  'self_harm',
  'harm_to_others',
  'abuse',
  'psychosis',
  'medical_emergency',
]);
const riskContextSchema = z.enum([
  'self',
  'third_party',
  'fiction',
  'historical',
  'hypothetical',
  'negated',
  'unclear',
]);

const classifierSchema = z.strictObject({
  level: riskLevelSchema,
  category: riskCategorySchema.optional(),
  evidence_quote: z.string().max(300).optional(),
  rationale: z.string().max(400).optional(),
  confidence: z.number().min(0).max(1),
  context: riskContextSchema.optional(),
});

const SYSTEM_PROMPT = [
  '你是安全分类器，只判断文本中是否存在自伤、自杀、他伤、虐待、精神病性体验或医疗急症的风险线索。',
  '你不做诊断，不提供建议，不提供任何方法、工具或时机。',
  '只输出一个 JSON 对象，不要 Markdown、代码围栏或解释。',
  'JSON 字段：',
  '{"level":"none|concern|imminent","category":"suicide|self_harm|harm_to_others|abuse|psychosis|medical_emergency","evidence_quote":"最多 200 字","rationale":"最多 300 字","confidence":0.0,"context":"self|third_party|fiction|historical|hypothetical|negated|unclear"}',
  'level 含义：none 无明显风险；concern 有线索但不明确；imminent 明确、当下、可执行的危险。',
  '如果把风险说成别人的、影视剧情、过去的事、假设或被明确否定，请放入 context，不要提高 level。',
].join('\n');

function truncate(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('');
}

function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('no json object');
  }
  return JSON.parse(stripped.slice(start, end + 1)) as unknown;
}

/**
 * 分类模型只用于复核，不替代本地规则。失败时返回 ok:false，
 * 由 SafetyService 按失败策略决定是否至少保持 concern。
 */
export class ModelRiskClassifier implements RiskClassifier {
  private readonly profile: ModelProfile;
  private readonly provider: ChatProvider;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: {
    profile: ModelProfile;
    provider: ChatProvider;
    apiKey?: string;
    timeoutMs?: number;
  }) {
    this.profile = options.profile;
    this.provider = options.provider;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 12000;
  }

  async classify(input: RiskClassifierInput): Promise<RiskClassifierResult> {
    const recent = input.recentUserMessages
      .slice(-4)
      .map((message) => '- ' + truncate(message, 500))
      .join('\n');
    const userText = [
      recent.length > 0 ? '最近用户表达（旧到新）：\n' + recent : '最近用户表达：无',
      '当前表达：\n' + truncate(input.currentMessage, 1200),
    ].join('\n\n');

    let output = '';
    try {
      for await (const event of this.provider.stream({
        profile: this.profile,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
        ...(this.apiKey !== undefined ? { apiKey: this.apiKey } : {}),
        temperature: 0,
        // DeepSeek 等推理模型会先消耗推理 token；300 曾在混合句上截断 JSON。
        maxTokens: 1000,
        timeoutMs: this.timeoutMs,
      })) {
        if (event.type === 'delta') {
          output += event.text;
        }
      }
    } catch (error) {
      const code = error instanceof ChatProviderError ? error.code : 'NETWORK';
      return { ok: false, errorCode: code };
    }

    try {
      const parsed = classifierSchema.safeParse(extractJson(output));
      if (!parsed.success) {
        return { ok: false, errorCode: 'PROTOCOL' };
      }
      return {
        ok: true,
        level: parsed.data.level,
        ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
        ...(parsed.data.evidence_quote !== undefined
          ? { evidenceQuote: parsed.data.evidence_quote }
          : {}),
        ...(parsed.data.rationale !== undefined ? { rationale: parsed.data.rationale } : {}),
        confidence: parsed.data.confidence,
        context: parsed.data.context ?? 'unclear',
      };
    } catch {
      return { ok: false, errorCode: 'PROTOCOL' };
    }
  }
}
