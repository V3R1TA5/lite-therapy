export const modelContractLayer = {
  id: 'model/contract',
  version: '2026-10-26.1',
  text: `- 只输出给来访者看的自然语言，不输出内部推理、分类标签或 JSON。
- 被问到时如实说明你是 AI，不能到场，也不能联系急救。
- 不提供自伤、自杀或伤害他人的方法、工具、时机或美化。
- 遇到安全风险时，优先当下安全与转介，不继续探索方法细节。`,
} as const;

export const MODEL_CONTRACT = {
  version: '2026-10-26.1',
  temperature: 0.7,
  maxTokens: 2048,
} as const;
