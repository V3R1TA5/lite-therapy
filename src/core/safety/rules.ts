import { maxRiskLevel, type RiskCategory, type RiskContext, type RiskLevel } from './types.js';

export interface RiskRule {
  id: string;
  category: RiskCategory;
  level: RiskLevel;
  pattern: RegExp;
}

export interface RuleMatch {
  ruleId: string;
  category: RiskCategory;
  level: RiskLevel;
  evidence: string;
  context: RiskContext;
  suppressed: boolean;
}

export interface RuleScanResult {
  level: RiskLevel;
  matches: RuleMatch[];
  signal: boolean;
  ambiguous: boolean;
}

/**
 * 规则只用于本地初筛，不做诊断。分类模型会复核；规则命中时，
 * 即使模型失败也必须至少保持 concern。
 */
const RULES: RiskRule[] = [
  {
    id: 'suicide.explicit',
    category: 'suicide',
    level: 'concern',
    pattern:
      /(?:自杀|轻生|想死|不想活(?:了|下去)?|活不下去|活着没(?:有)?(?:意思|意义)|结束(?:自己的)?生命|kill\s+myself|want\s+to\s+die|end\s+my\s+life|suicid(?:e|al))/i,
  },
  {
    id: 'suicide.plan',
    category: 'suicide',
    level: 'imminent',
    pattern:
      /(?:准备|打算|计划|决定|已经).{0,12}(?:自杀|轻生|去死|结束生命|跳楼|割腕|吞药|上吊)|(?:今晚|现在|马上|立刻).{0,12}(?:自杀|去死|结束生命|跳下去)|遗书|告别.{0,8}(?:世界|所有人)|(?:站在|走到).{0,8}(?:楼顶|天台|桥边|窗边).{0,12}(?:想|准备|要|跳|结束)/i,
  },
  {
    id: 'self_harm.explicit',
    category: 'self_harm',
    level: 'concern',
    pattern:
      /(?:自残|自伤|伤害自己|割(?:自己|腕)|划(?:自己|胳膊)|烫自己|hurt\s+myself|self[-\s]?harm|cut\s+myself)/i,
  },
  {
    id: 'self_harm.plan',
    category: 'self_harm',
    level: 'imminent',
    pattern:
      /(?:现在|马上|今晚|已经).{0,12}(?:割(?:自己|腕)|划(?:自己|胳膊)|烫自己|伤害自己)|(?:准备|打算).{0,12}(?:割(?:自己|腕)|划(?:自己|胳膊)|烫自己|伤害自己)/i,
  },
  {
    id: 'harm_to_others.explicit',
    category: 'harm_to_others',
    level: 'concern',
    pattern:
      /(?:想|要|准备|计划).{0,8}(?:杀|伤害|弄死).{0,6}(?:他|她|他们|别人|某人)|(?:杀|伤害)(?:了)?(?:他|她)|kill\s+(?:him|her|them)|hurt\s+(?:him|her|them)/i,
  },
  {
    id: 'abuse.explicit',
    category: 'abuse',
    level: 'concern',
    pattern:
      /(?:被|遭).{0,6}(?:虐待|家暴|性侵|强暴|猥亵|打伤|殴打)|(?:家暴|虐待|性侵|强暴|猥亵)|\babuse\b|\bassault\b|\brape\b/i,
  },
  {
    id: 'psychosis.explicit',
    category: 'psychosis',
    level: 'concern',
    pattern:
      /(?:幻听|幻觉|听到.{0,8}(?:声音|说话)|有人.{0,6}(?:监视|跟踪|控制)我|被控制|不是真实|世界是假的|thought\s+broadcasting|hearing\s+voices)/i,
  },
  {
    id: 'medical.explicit',
    category: 'medical_emergency',
    level: 'concern',
    pattern:
      /(?:胸痛|呼吸困难|喘不上气|大出血|昏迷|抽搐|服(?:了)?(?:很多|过量).{0,4}药|药物过量|medical\s+emergency|can't\s+breathe|overdose)/i,
  },
];

const AMBIGUOUS_PATTERN =
  /(?:活着(?:很|太)?累|没有希望|绝望|撑不住|撑不下去|想消失|不想存在|解脱|空洞|麻木|hopeless|worthless|numb)/i;

const PRESENT_MARKERS = /(?:现在|最近|今天|这周|这个月|又|还是|正在|马上|今晚)/i;
const THIRD_PARTY_PATTERN =
  /(?:朋友|同学|同事|家人|妈|爸|母亲|父亲|孩子|儿子|女儿|别人|有人|患者|来访者|新闻|奶奶|爷爷|外婆|外公|姥姥|姥爷|哥哥|姐姐|弟弟|妹妹|先生|太太|老公|老婆|男友|女友|对象|领导|老师|医生|咨询师|他|她|他们|她们|friend|someone|client|my\s+(?:friend|partner|mother|father|son|daughter))/i;
const THIRD_PARTY_FRAME =
  /(?:朋友|同学|同事|家人|妈|爸|母亲|父亲|孩子|儿子|女儿|别人|有人|患者|来访者|奶奶|爷爷|外婆|外公|姥姥|姥爷|哥哥|姐姐|弟弟|妹妹|先生|太太|老公|老婆|男友|女友|对象|领导|老师|医生|咨询师|他|她|他们|她们|friend|someone|client).{0,20}(?:说|告诉|提到|想|要|准备|曾经|最近|有|said|wants|is|was|has)/i;
const FICTION_PATTERN =
  /(?:电影|电视剧|小说|游戏|故事|剧情|角色|动漫|fiction|movie|novel|game|book|character)/i;
const HISTORICAL_PATTERN = /(?:以前|曾经|过去|小时候|去年|那次|当时|used\s+to|in\s+the\s+past)/i;
const HYPOTHETICAL_PATTERN = /(?:如果|假如|要是|万一|假设|\bif\b|\bwhat\s+if\b)/i;
const SELF_CONTINUATION_PATTERN =
  /(?:我|自己)(?:(?!(?:朋友|同学|同事|家人|妈妈|妈|爸爸|爸|先生|太太|老公|老婆|伴侣|孩子|儿子|女儿|他|她|他们|她们))[^。！？!?；;\n]){0,8}?(?:也有过|也有|也想过|也会想|也是一样|也一样|也是|同样|曾经也|最近也)(?=$|[，,。；;！？!?]|(?:要|想|会|准备|打算)?(?:这个|那个|这种|那种|同样的?|类似的?|一样的?)?(?:念头|想法|感觉|经历|情况|自杀|死|伤害自己|不想活|结束|轻生))/;
const NEGATION_PATTERN =
  /(?:(?:没有|没|不会|不打算|从未|并不|从来没|(?<!想)不想|不)\s*$|(?:没有|没|从未|从来没).{0,6}(?:想过|考虑过)\s*$|(?:没有|没|从未|从来没).{0,6}(?:想|打算|准备|计划|考虑)\s*$|\b(?:not|never|don't|didn't)\s*$)/i;

function evidenceFor(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 120);
}

function clauseStart(text: string, index: number): number {
  let start = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (/[。！？!?；;\n]/.test(text[cursor] ?? '')) {
      start = cursor + 1;
      break;
    }
  }
  const comma = Math.max(text.lastIndexOf('，', index - 1), text.lastIndexOf(',', index - 1));
  if (comma >= start) {
    const tail = text.slice(comma + 1, index);
    // 只把最后一个“我/自己/咱”视为主语切换；若其后又出现第三人称，仍按第三人称处理。
    const selfMatches = [...tail.matchAll(/(?:我|自己|咱)/g)];
    const lastSelf = selfMatches[selfMatches.length - 1];
    if (lastSelf !== undefined && lastSelf.index !== undefined) {
      const rest = tail.slice(lastSelf.index + lastSelf[0].length);
      if (!THIRD_PARTY_PATTERN.test(rest)) {
        start = comma + 1;
      }
    }
  }
  return start;
}

function detectContext(text: string, index: number, length: number): RiskContext {
  const start = clauseStart(text, index);
  const end = Math.min(text.length, index + length + 24);
  const before = text.slice(Math.max(start, index - 48), index);
  const around = text.slice(Math.max(start, index - 48), end);
  const after = text.slice(index + length, Math.min(text.length, index + length + 24));

  if (FICTION_PATTERN.test(around)) {
    return 'fiction';
  }
  if (THIRD_PARTY_FRAME.test(before) || THIRD_PARTY_FRAME.test(around)) {
    return 'third_party';
  }
  if (THIRD_PARTY_PATTERN.test(before) && /(?:说|告诉|提到|想|要|准备|曾经|最近|有)/.test(after)) {
    return 'third_party';
  }
  if (NEGATION_PATTERN.test(before)) {
    return 'negated';
  }
  if (HISTORICAL_PATTERN.test(around) && !PRESENT_MARKERS.test(around)) {
    return 'historical';
  }
  if (HYPOTHETICAL_PATTERN.test(around)) {
    return 'hypothetical';
  }
  return 'self';
}

function levelAfterContext(
  level: RiskLevel,
  context: RiskContext,
): { level: RiskLevel; suppressed: boolean } {
  if (context === 'fiction' || context === 'third_party' || context === 'negated') {
    return { level: 'none', suppressed: true };
  }
  if (context === 'historical' || context === 'hypothetical') {
    return { level: level === 'imminent' ? 'concern' : level, suppressed: false };
  }
  return { level, suppressed: false };
}

export function scanRiskText(text: string): RuleScanResult {
  const matches: RuleMatch[] = [];
  let level: RiskLevel = 'none';
  let hasSelfContinuation = false;
  let continuationEvidence = '';

  for (const rule of RULES) {
    // 同一句里可能先提第三人、再讲自己；只看第一个命中会把后半句一起压掉。
    const pattern = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`,
    );
    let match = pattern.exec(text);
    while (match !== null) {
      const context = detectContext(text, match.index, match[0].length);
      const adjusted = levelAfterContext(rule.level, context);
      const result: RuleMatch = {
        ruleId: rule.id,
        category: rule.category,
        level: adjusted.level,
        evidence: evidenceFor(text, match.index, match[0].length),
        context,
        suppressed: adjusted.suppressed,
      };
      matches.push(result);
      if (
        context === 'third_party' &&
        SELF_CONTINUATION_PATTERN.test(text.slice(match.index + match[0].length))
      ) {
        hasSelfContinuation = true;
        continuationEvidence = text
          .slice(match.index + match[0].length)
          .trim()
          .slice(0, 120);
      }
      if (!adjusted.suppressed) {
        level = maxRiskLevel(level, adjusted.level);
      }
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }
      match = pattern.exec(text);
    }
  }

  const hasSelfMatch = matches.some((match) => match.context === 'self' && !match.suppressed);
  const thirdPartySource = [...matches].reverse().find((match) => match.context === 'third_party');
  if (!hasSelfMatch && thirdPartySource !== undefined && hasSelfContinuation) {
    // “朋友说他想自杀，我也有过”没有第二次出现风险词，但主语已经切回本人。
    matches.push({
      ruleId: thirdPartySource.ruleId + '.self_continuation',
      category: thirdPartySource.category,
      level: 'concern',
      evidence: continuationEvidence,
      context: 'self',
      suppressed: false,
    });
    level = 'concern';
  }

  const ambiguous = AMBIGUOUS_PATTERN.test(text);
  const hasSuppressedThirdParty = matches.some((match) => match.context === 'third_party');
  return {
    level,
    matches,
    signal: matches.length > 0 || ambiguous,
    ambiguous: ambiguous || hasSuppressedThirdParty,
  };
}
