import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import { ChatProviderError } from '../src/providers/types.js';

interface EmbeddingCase {
  query: string;
  expected: number;
  note: string;
}

const CARDS = [
  '工作项目截止日期逼近，压力很大',
  '和伴侣因为周末安排争吵',
  '晚上入睡困难，凌晨醒来',
  '很久没有和朋友联系，感到孤单',
  '肩颈长期紧张，身体放松不下来',
  '反复思考这么忙到底为了什么',
  '开始尝试每天散步十分钟',
  '害怕在会谈里被评价',
];

const CASES: EmbeddingCase[] = [
  { query: '职业发展让我焦虑', expected: 0, note: '工作压力' },
  { query: '和家人发生了冲突', expected: 1, note: '关系冲突' },
  { query: '最近睡眠很差', expected: 2, note: '睡眠' },
  { query: '没有人理解我', expected: 3, note: '孤独' },
  { query: '身体一直紧绷', expected: 4, note: '身体紧张' },
  { query: '不知道忙碌的意义', expected: 5, note: '意义感' },
];

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

const baseUrl = process.env.EMBEDDING_BASE_URL?.trim() || 'http://127.0.0.1:11434/v1';
const model = process.env.EMBEDDING_MODEL?.trim() || 'qwen3-embedding:0.6b';
const profile = {
  id: 'embedding-eval',
  label: 'Embedding eval',
  kind: 'openai-compatible' as const,
  baseUrl,
  model,
};

console.log('Lite Therapy local embedding spot check');
console.log('合成卡片与查询，不读真实会谈；结果不是语义质量保证。');
console.log('endpoint: ' + baseUrl);
console.log('model: ' + model + '\n');

try {
  const provider = new OpenAICompatibleProvider();
  const vectors = await provider.embed({
    profile,
    model,
    input: [...CARDS, ...CASES.map((item) => item.query)],
    timeoutMs: 180_000,
  });
  const cardVectors = vectors.slice(0, CARDS.length);
  const queryVectors = vectors.slice(CARDS.length);
  const dimension = vectors[0]?.length ?? 0;
  let hits = 0;

  for (const [index, item] of CASES.entries()) {
    const vector = queryVectors[index];
    if (vector === undefined) {
      throw new Error('查询向量缺失。');
    }
    const ranked = CARDS.map((card, cardIndex) => ({
      card,
      score: cosine(vector, cardVectors[cardIndex] ?? []),
    })).sort((left, right) => right.score - left.score);
    const top = ranked[0];
    const expectedCard = CARDS[item.expected];
    const ok = top?.card === expectedCard;
    if (ok) {
      hits += 1;
    }
    console.log(
      (ok ? 'HIT ' : 'MISS') +
        ' | ' + item.query +
        ' | 期望：' + expectedCard +
        ' | 第一：' + (top?.card ?? '（无）') +
        ' | ' + (top?.score ?? 0).toFixed(4),
    );
    if (!ok) {
      console.log('       ' + item.note + '；第二：' + (ranked[1]?.card ?? '（无）') +
        ' | ' + (ranked[1]?.score ?? 0).toFixed(4));
    }
  }

  console.log('\ndimension: ' + dimension + ' | top1: ' + hits + '/' + CASES.length);
  console.log('这是观察性抽查，不是 CI 门槛，也不代表整体中文语义质量。');
  if (process.env.EMBEDDING_STRICT === '1' && hits < CASES.length) {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof ChatProviderError
    ? error.code + ': ' + error.message
    : error instanceof Error
      ? error.message
      : String(error);
  console.error('embedding spot check failed: ' + message);
  console.error('请确认 Ollama 正在运行，且模型已安装：ollama pull ' + model);
  process.exitCode = 1;
}
