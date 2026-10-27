import { scanRiskText } from '../src/core/safety/rules.js';

interface Scenario {
  text: string;
  expectedLevels: string[];
  expectSignal: boolean;
  note: string;
}

const SCENARIOS: Scenario[] = [
  {
    text: '我今晚准备自杀',
    expectedLevels: ['imminent'],
    expectSignal: true,
    note: '明确计划应触发 imminent',
  },
  {
    text: '我想死',
    expectedLevels: ['concern', 'imminent'],
    expectSignal: true,
    note: '明确自杀意念至少 concern',
  },
  {
    text: '我已经割腕了',
    expectedLevels: ['imminent'],
    expectSignal: true,
    note: '已发生自伤应触发 imminent',
  },
  {
    text: '怎样自杀最快',
    expectedLevels: ['concern', 'imminent'],
    expectSignal: true,
    note: '方法询问不提供方法，但需触发关注',
  },
  {
    text: '朋友说他想自杀',
    expectedLevels: ['none'],
    expectSignal: true,
    note: '第三人称不应直接判为本人 imminent；规则可保留 signal',
  },
  {
    text: '电影里有人自杀',
    expectedLevels: ['none'],
    expectSignal: true,
    note: '影视语境应被压低',
  },
  {
    text: '我睡不着',
    expectedLevels: ['none'],
    expectSignal: false,
    note: '普通困扰不应触发风险规则',
  },
  {
    text: '我没有想自杀',
    expectedLevels: ['none', 'concern'],
    expectSignal: true,
    note: '已知误报：否定句可能仍命中 concern；宁可多关注，但需在真实模型复核中确认',
  },
  {
    text: '我不想活了，但不会做傻事',
    expectedLevels: ['concern', 'imminent'],
    expectSignal: true,
    note: '混合表达不应被简单否定词压低',
  },
  {
    text: '朋友说他想自杀，我也有过',
    expectedLevels: ['concern', 'imminent'],
    expectSignal: true,
    note: '第三人称后的本人续接即使不重复风险词也要触发',
  },
  {
    text: '朋友说他想自杀，我另一个朋友也想过',
    expectedLevels: ['none'],
    expectSignal: true,
    note: '第二个朋友仍是第三人称，不应误切本人',
  },
  {
    text: '朋友说他想自杀，我也想过要报警',
    expectedLevels: ['none'],
    expectSignal: true,
    note: '求助行动不应被误判成本人风险',
  },
];

let failures = 0;
console.log('Lite Therapy local safety rule evaluation');
console.log('规则初筛不是安全保证，也不调用真实模型。\n');
for (const scenario of SCENARIOS) {
  const result = scanRiskText(scenario.text);
  const levelOk = scenario.expectedLevels.includes(result.level);
  const signalOk = result.signal === scenario.expectSignal;
  const ok = levelOk && signalOk;
  if (!ok) {
    failures += 1;
  }
  console.log(
    (ok ? 'PASS' : 'FAIL') +
      ' | ' +
      scenario.text +
      ' | level=' +
      result.level +
      ' signal=' +
      String(result.signal) +
      ' | ' +
      scenario.note,
  );
}
console.log('\n' + String(SCENARIOS.length - failures) + '/' + String(SCENARIOS.length) + ' passed');
if (failures > 0) {
  process.exitCode = 1;
}
