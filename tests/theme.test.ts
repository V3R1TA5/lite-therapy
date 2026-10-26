import { afterEach, describe, expect, it } from 'vitest';
import { setUiTheme, uiColor } from '../src/ui/theme.js';

const originalNoColor = process.env.NO_COLOR;

afterEach(() => {
  setUiTheme('dark');
  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = originalNoColor;
  }
});

describe('ui theme', () => {
  it('switches between dark and light palettes', () => {
    delete process.env.NO_COLOR;
    setUiTheme('dark');
    expect(uiColor('danger')).toBe('red');
    expect(uiColor('accent')).toBe('cyan');

    setUiTheme('light');
    expect(uiColor('danger')).toBe('#8a2f2f');
    expect(uiColor('accent')).toBe('#3f6b6b');
  });

  it('returns no color when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    setUiTheme('dark');
    expect(uiColor('danger')).toBeUndefined();
    expect(uiColor('success')).toBeUndefined();
  });
});
