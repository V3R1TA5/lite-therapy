import { describe, expect, it } from 'vitest';
import { scanRiskText } from '../src/core/safety/rules.js';

describe('safety rules', () => {
  it('flags explicit suicide and self-harm language as concern', () => {
    expect(scanRiskText('我最近真的不想活了').level).toBe('concern');
    expect(scanRiskText('有时候我会想死').level).toBe('concern');
    expect(scanRiskText('我开始自残了').level).toBe('concern');
    expect(scanRiskText('我想伤害自己')).toMatchObject({ level: 'concern' });
  });

  it('raises explicit plans to imminent', () => {
    expect(scanRiskText('我今晚准备自杀').level).toBe('imminent');
    expect(scanRiskText('我已经写好遗书了').level).toBe('imminent');
    expect(scanRiskText('我现在就要结束生命').level).toBe('imminent');
  });

  it('suppresses negated protective statements', () => {
    const result = scanRiskText('我不想死，只是最近很累');
    expect(result.level).toBe('none');
    expect(result.matches.some((match) => match.context === 'negated')).toBe(true);

    expect(scanRiskText('我没有自杀的想法').level).toBe('none');
    expect(scanRiskText('我没有想自杀，只是最近很累').level).toBe('none');
    expect(scanRiskText('我不会伤害自己').level).toBe('none');
    expect(scanRiskText('我不确定想不想自杀').level).toBe('concern');
  });

  it('does not suppress ambivalent statements', () => {
    const result = scanRiskText('我想自杀，但我也害怕死');
    expect(result.level).toBe('concern');
  });

  it('keeps a later self statement after a third-party clause', () => {
    const mixed = scanRiskText('朋友说他想自杀，其实我也想过自杀');
    expect(mixed.level).toBe('concern');
    expect(mixed.matches.some((match) => match.context === 'third_party')).toBe(true);
    expect(mixed.matches.some((match) => match.context === 'self')).toBe(true);
  });

  it('keeps a later self statement after a negated clause', () => {
    const mixed = scanRiskText('我没有想自杀，但后来还是自杀了');
    expect(mixed.level).toBe('concern');
    expect(mixed.matches.some((match) => match.context === 'self')).toBe(true);
  });

  it('does not treat a third party after "我" as the user', () => {
    const friend = scanRiskText('朋友说他想自杀，我觉得他可能也想自杀');
    expect(friend.level).toBe('none');
    expect(
      friend.matches.filter((match) => match.context === 'third_party').length,
    ).toBeGreaterThanOrEqual(2);

    const spouse = scanRiskText('朋友说他想自杀，我先生也说过想死');
    expect(spouse.level).toBe('none');
    expect(spouse.matches.some((match) => match.context === 'third_party')).toBe(true);
  });

  it('keeps first-person continuation after a third-party risk without repeating the word', () => {
    const mixed = scanRiskText('朋友说他想自杀，我也有过');
    expect(mixed.level).toBe('concern');
    expect(mixed.matches.some((match) => match.context === 'self')).toBe(true);

    expect(scanRiskText('朋友说他想自杀，我也想过').level).toBe('concern');
    expect(scanRiskText('朋友说他想自杀，我也有过这个念头').level).toBe('concern');
    expect(scanRiskText('朋友说他想自杀，我也想过要结束').level).toBe('concern');
    expect(scanRiskText('朋友说他想自杀，我也有过很多疑问').level).toBe('none');
    expect(scanRiskText('朋友说他想自杀，我也想过怎么帮他').level).toBe('none');
    expect(scanRiskText('朋友说他想自杀，我也一样担心他').level).toBe('none');
    expect(scanRiskText('朋友说他想自杀，我也想过要报警').level).toBe('none');
    expect(scanRiskText('朋友说他想自杀，我也想过这个办法').level).toBe('none');
    const historical = scanRiskText('我以前自杀过，朋友说他想自杀，我也有过');
    expect(historical.level).toBe('concern');
    expect(historical.matches.some((match) => match.context === 'self')).toBe(true);
  });

  it('recognizes a parent subject even after a comma', () => {
    const result = scanRiskText('我妈，最近总说想死');
    expect(result.level).toBe('none');
    expect(result.matches.some((match) => match.context === 'third_party')).toBe(true);
  });

  it('suppresses third-party and fiction contexts but keeps them for review', () => {
    const thirdParty = scanRiskText('我朋友说他想自杀');
    expect(thirdParty.level).toBe('none');
    expect(thirdParty.matches.some((match) => match.context === 'third_party')).toBe(true);
    expect(thirdParty.signal).toBe(true);

    const fiction = scanRiskText('电影里有人自杀，剧情很压抑');
    expect(fiction.level).toBe('none');
    expect(fiction.matches.some((match) => match.context === 'fiction')).toBe(true);
  });

  it('keeps historical and hypothetical mentions at concern, not imminent', () => {
    const historical = scanRiskText('我以前自杀过，现在又想起那件事');
    expect(historical.level).toBe('concern');

    const hypothetical = scanRiskText('如果我自杀了，你会怎么反应');
    expect(hypothetical.level).toBe('concern');
    expect(hypothetical.level).not.toBe('imminent');
  });

  it('detects abuse, harm to others, psychosis and medical emergencies', () => {
    expect(scanRiskText('我被家暴了，不敢回家').matches[0]?.category).toBe('abuse');
    expect(scanRiskText('我想杀了他').matches[0]?.category).toBe('harm_to_others');
    expect(scanRiskText('最近总能听到别人听不到的声音').matches[0]?.category).toBe('psychosis');
    expect(scanRiskText('胸口很痛，呼吸困难').matches[0]?.category).toBe('medical_emergency');
  });

  it('marks vague hopelessness as ambiguous for classifier review', () => {
    const result = scanRiskText('活着很累，感觉没有希望');
    expect(result.level).toBe('none');
    expect(result.ambiguous).toBe(true);
    expect(result.signal).toBe(true);
  });

  it('does not treat buying medicine as an imminent plan by itself', () => {
    expect(scanRiskText('我准备去买点感冒药').level).toBe('none');
  });
});
