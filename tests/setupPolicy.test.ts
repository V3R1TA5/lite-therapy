import { describe, expect, it } from 'vitest';
import {
  checkRecoveryAnswers,
  createRecoveryChallenge,
  normalizeAnswer,
  splitMnemonic,
  validateNewPassphrase,
  validatePassphraseConfirmation,
} from '../src/services/setupPolicy.js';

const PHRASE =
  'abandon ability able about above absent absorb abstract absurd abuse access accident';

describe('setupPolicy', () => {
  it('picks three distinct words in ascending positions', () => {
    const challenge = createRecoveryChallenge(PHRASE, () => 0);
    expect(challenge.indexes).toEqual([0, 1, 2]);
    expect(challenge.words).toEqual(['abandon', 'ability', 'able']);

    let counter = 0;
    const challenge2 = createRecoveryChallenge(PHRASE, () => {
      counter += 1;
      return counter % 3 === 0 ? 2 : 0;
    });
    expect(new Set(challenge2.indexes).size).toBe(3);
    expect(challenge2.indexes).toEqual([...challenge2.indexes].sort((a, b) => a - b));
    for (const [position, index] of challenge2.indexes.entries()) {
      expect(challenge2.words[position]).toBe(splitMnemonic(PHRASE)[index]);
    }
  });

  it('checks answers case-insensitively and ignores extra whitespace', () => {
    const challenge = createRecoveryChallenge(PHRASE, () => 0);
    expect(checkRecoveryAnswers(challenge, ['  ABANDON ', 'Ability', 'able'])).toBe(true);
    expect(checkRecoveryAnswers(challenge, ['abandon', 'ability', 'wrong'])).toBe(false);
    expect(normalizeAnswer('  ABANDON  ')).toBe('abandon');
  });

  it('validates passphrase length and confirmation', () => {
    expect(validateNewPassphrase('short')).not.toBeNull();
    expect(validateNewPassphrase('        ')).not.toBeNull();
    expect(validateNewPassphrase('long enough passphrase')).toBeNull();
    expect(validatePassphraseConfirmation('long enough passphrase', 'different')).toBe(
      '两次输入的启动密码不一致。',
    );
    expect(
      validatePassphraseConfirmation('long enough passphrase', 'long enough passphrase'),
    ).toBeNull();
  });

  it('rejects phrases that are not twelve words', () => {
    expect(() => createRecoveryChallenge('too short')).toThrow('12');
  });
});
