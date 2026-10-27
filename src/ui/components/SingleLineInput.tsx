import {
  Box,
  type DOMElement,
  measureElement,
  Text,
  useCursor,
  useInput,
  usePaste,
  useWindowSize,
} from 'ink';
import { useEffect, useRef, useState } from 'react';
import stringWidth from 'string-width';
import { uiColor } from '../theme.js';

export interface SingleLineInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onEscape?: () => void;
  placeholder?: string;
  mask?: boolean;
  disabled?: boolean;
  focus?: boolean;
}

function maskText(value: string): string {
  return '•'.repeat(Array.from(value).length);
}

/**
 * 单行输入。支持粘贴，是因为 12 词恢复短语与长密码几乎一定要粘贴。
 * 光标目前是绘制块，不是终端真实光标；IME 定位问题与 M0 输入框相同。
 */
export function SingleLineInput(props: SingleLineInputProps) {
  const {
    value,
    onChange,
    onSubmit,
    onEscape,
    placeholder = '',
    mask = false,
    disabled = false,
    focus = true,
  } = props;
  const [cursor, setCursor] = useState(value.length);
  const boxRef = useRef<DOMElement>(null);
  const { columns } = useWindowSize();
  const { setCursorPosition } = useCursor();
  const active = !disabled && focus;

  useEffect(() => {
    setCursor((current) => Math.max(0, Math.min(current, value.length)));
  }, [value.length]);

  useEffect(() => {
    const node = boxRef.current;
    if (!active || node === null) {
      setCursorPosition(undefined);
      return;
    }
    const { x, y, width } = measureElement(node);
    const wrapWidth = columns > 0 ? columns : width;
    const before = mask
      ? '•'.repeat(Array.from(value.slice(0, cursor)).length)
      : value.slice(0, cursor);
    const prefix = stringWidth('› ') + stringWidth(before);
    setCursorPosition({
      x: x + (prefix % wrapWidth),
      y: y + Math.floor(prefix / wrapWidth),
    });
    return () => {
      setCursorPosition(undefined);
    };
  }, [active, columns, cursor, mask, setCursorPosition, value]);

  const insert = (text: string) => {
    const cleaned = text.replace(/[\r\n]+/g, ' ');
    if (cleaned.length === 0) {
      return;
    }
    onChange(value.slice(0, cursor) + cleaned + value.slice(cursor));
    setCursor(cursor + cleaned.length);
  };

  usePaste(
    (text) => {
      insert(text);
    },
    { isActive: active },
  );

  useInput(
    (input, key) => {
      // Windows/自动化可能把文本和回车放在同一个 input 块里，同时把 key.return 设为 true。
      // 必须先消费块内文本，否则提交的是上一帧的 value（常见表现是空密码或空消息）。
      const newlineIndex = input.search(/[\r\n]/);
      if (newlineIndex >= 0) {
        const typed = input.slice(0, newlineIndex);
        const next = value.slice(0, cursor) + typed + value.slice(cursor);
        if (typed.length > 0) {
          onChange(next);
          setCursor(cursor + typed.length);
        }
        onSubmit(next);
        return;
      }
      if (key.return) {
        onSubmit(value);
        return;
      }
      if (key.escape) {
        onEscape?.();
        return;
      }
      if (key.leftArrow) {
        setCursor((current) => Math.max(0, current - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((current) => Math.min(value.length, current + 1));
        return;
      }
      if (key.home) {
        setCursor(0);
        return;
      }
      if (key.end) {
        setCursor(value.length);
        return;
      }
      if (key.backspace) {
        if (cursor > 0) {
          onChange(value.slice(0, cursor - 1) + value.slice(cursor));
          setCursor(cursor - 1);
        }
        return;
      }
      if (key.delete) {
        if (cursor < value.length) {
          onChange(value.slice(0, cursor) + value.slice(cursor + 1));
        }
        return;
      }
      if (key.ctrl && input === 'u') {
        onChange('');
        setCursor(0);
        return;
      }
      if (key.tab || input === '\t') {
        return;
      }
      if (input.length > 0 && !key.ctrl && !key.meta) {
        insert(input);
      }
    },
    { isActive: active },
  );

  if (value.length === 0) {
    return (
      <Box ref={boxRef}>
        <Text color={uiColor('accent')}>› </Text>
        <Text dimColor>{placeholder}</Text>
      </Box>
    );
  }

  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1);
  const after = value.slice(cursor + 1);
  const shownBefore = mask ? maskText(before) : before;
  const shownAt = mask ? (at.length > 0 ? '•' : ' ') : at.length > 0 ? at : ' ';
  const shownAfter = mask ? maskText(after) : after;

  return (
    <Box ref={boxRef}>
      <Text color={uiColor('accent')}>› </Text>
      <Text>
        {shownBefore}
        {shownAt}
        {shownAfter}
      </Text>
    </Box>
  );
}
