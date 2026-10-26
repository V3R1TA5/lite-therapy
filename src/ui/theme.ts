import type { ThemeMode } from '../config/appConfig.js';

export type ThemeRole =
  | 'danger'
  | 'warning'
  | 'success'
  | 'accent'
  | 'muted'
  | 'user'
  | 'assistant';

const PALETTES: Record<ThemeMode, Record<ThemeRole, string>> = {
  dark: {
    danger: 'red',
    warning: 'yellow',
    success: 'green',
    accent: 'cyan',
    muted: 'gray',
    user: 'blue',
    assistant: 'green',
  },
  light: {
    danger: '#8a2f2f',
    warning: '#8a6d1f',
    success: '#3f6b4f',
    accent: '#3f6b6b',
    muted: '#666666',
    user: '#3f5f8a',
    assistant: '#3f6b5a',
  },
};

let activeTheme: ThemeMode = 'dark';

export function setUiTheme(mode: ThemeMode): void {
  activeTheme = mode;
}

/** NO_COLOR 下只靠标签、缩进和符号区分，不输出 ANSI 颜色。 */
export function uiColor(role: ThemeRole): string | undefined {
  if (Object.hasOwn(process.env, 'NO_COLOR')) {
    return undefined;
  }
  return PALETTES[activeTheme][role];
}
