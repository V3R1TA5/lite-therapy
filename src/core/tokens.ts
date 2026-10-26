/**
 * 保守的 token 估算，用于 M2 的用量记录与之后的上下文预算。
 * 汉字按 1 token/字，其他字符按 0.3 token/字符，再加 10% 余量。
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (isCjk(code)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil((cjk + other * 0.3) * 1.1);
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}
