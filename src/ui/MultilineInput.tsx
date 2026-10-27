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

export interface MultilineInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLines?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lineColAt(value: string, cursor: number): { line: number; col: number } {
  const before = value.slice(0, cursor);
  const parts = before.split('\n');
  const line = parts.length - 1;
  return { line, col: (parts[line] ?? '').length };
}

function positionAt(value: string, line: number, col: number): number {
  const lines = value.split('\n');
  const targetLine = clamp(line, 0, lines.length - 1);
  let index = 0;
  for (let i = 0; i < targetLine; i += 1) {
    index += (lines[i] ?? '').length + 1;
  }
  return index + clamp(col, 0, (lines[targetLine] ?? '').length);
}

function moveVertical(value: string, cursor: number, delta: number): number {
  const { line, col } = lineColAt(value, cursor);
  return positionAt(value, line + delta, col);
}

function deleteWordBefore(value: string, cursor: number): { next: string; cursor: number } {
  let index = cursor;
  while (index > 0 && /\s/.test(value[index - 1] ?? '')) {
    index -= 1;
  }
  while (index > 0 && !/\s/.test(value[index - 1] ?? '')) {
    index -= 1;
  }
  return { next: value.slice(0, index) + value.slice(cursor), cursor: index };
}

export function cursorOffset(
  lineBefore: string,
  row: number,
  hintOffset = 0,
  wrapWidth = 0,
  rowsBefore = 0,
): { x: number; y: number } {
  const width = wrapWidth > 0 ? wrapWidth : Number.MAX_SAFE_INTEGER;
  const prefix = stringWidth(lineBefore);
  return {
    x: prefix % width,
    y: rowsBefore + row + hintOffset + Math.floor(prefix / width),
  };
}

export function MultilineInput(props: MultilineInputProps) {
  const {
    value,
    onChange,
    onSubmit,
    placeholder = '想说点什么…',
    disabled = false,
    maxLines = 6,
  } = props;
  const [cursor, setCursor] = useState(value.length);
  const boxRef = useRef<DOMElement>(null);
  const { columns } = useWindowSize();
  const { setCursorPosition } = useCursor();

  useEffect(() => {
    setCursor((current) => clamp(current, 0, value.length));
  }, [value.length]);

  const insert = (text: string) => {
    const next = value.slice(0, cursor) + text + value.slice(cursor);
    onChange(next);
    setCursor(cursor + text.length);
  };

  const replaceRange = (start: number, end: number, text: string) => {
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    setCursor(start + text.length);
  };

  usePaste(
    (text) => {
      if (disabled) {
        return;
      }
      const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      insert(normalized);
    },
    { isActive: !disabled },
  );

  useInput(
    (input, key) => {
      if (disabled) {
        return;
      }

      if (input === '\n') {
        insert('\n');
        return;
      }

      if (key.return) {
        if (key.shift) {
          insert('\n');
          return;
        }
        // Windows/自动化可能把文本和回车放在同一个 input 块里，同时置 key.return=true。
        const newlineIndex = input.search(/[\r\n]/);
        const typed = newlineIndex >= 0 ? input.slice(0, newlineIndex) : input;
        const next = value.slice(0, cursor) + typed + value.slice(cursor);
        if (typed.length > 0) {
          onChange(next);
          setCursor(cursor + typed.length);
        }
        if (next.trim().length > 0) {
          onSubmit(next);
        }
        return;
      }

      // 自动化工具或快速粘贴可能把“文本 + 回车”放在同一个数据块里。
      // 纯 '\n' 仍保留给 Ctrl+J 换行，这里只处理带文本的块。
      if (input.includes('\r') || (input.length > 1 && input.includes('\n'))) {
        const newlineIndex = input.search(/[\r\n]/);
        const typed = newlineIndex >= 0 ? input.slice(0, newlineIndex) : input;
        const next = value.slice(0, cursor) + typed + value.slice(cursor);
        onChange(next);
        setCursor(cursor + typed.length);
        if (next.trim().length > 0) {
          onSubmit(next);
        }
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
      if (key.upArrow) {
        setCursor((current) => moveVertical(value, current, -1));
        return;
      }
      if (key.downArrow) {
        setCursor((current) => moveVertical(value, current, 1));
        return;
      }
      if (key.home) {
        const { line } = lineColAt(value, cursor);
        setCursor(positionAt(value, line, 0));
        return;
      }
      if (key.end) {
        const { line } = lineColAt(value, cursor);
        const lines = value.split('\n');
        setCursor(positionAt(value, line, (lines[line] ?? '').length));
        return;
      }
      if (key.backspace) {
        if (cursor > 0) {
          replaceRange(cursor - 1, cursor, '');
        }
        return;
      }
      if (key.delete) {
        if (cursor < value.length) {
          replaceRange(cursor, cursor + 1, '');
        }
        return;
      }
      if (key.ctrl && input === 'u') {
        onChange('');
        setCursor(0);
        return;
      }
      if (key.ctrl && input === 'w') {
        const result = deleteWordBefore(value, cursor);
        onChange(result.next);
        setCursor(result.cursor);
        return;
      }
      if (key.escape || key.tab) {
        return;
      }
      if (input.length > 0 && !key.ctrl && !key.meta) {
        insert(input);
      }
    },
    { isActive: !disabled },
  );

  const lines = value.length === 0 ? [''] : value.split('\n');
  const { line: cursorLine, col: cursorCol } = lineColAt(value, cursor);
  const windowStart = Math.max(0, cursorLine - maxLines + 1);
  const windowEnd = Math.min(lines.length, windowStart + maxLines);
  const visibleLines = lines.slice(windowStart, windowEnd);

  useEffect(() => {
    const node = boxRef.current;
    if (disabled || node === null) {
      setCursorPosition(undefined);
      return;
    }
    const { x, y, width } = measureElement(node);
    const wrapWidth = columns > 0 ? columns : width;
    const hintOffset = windowStart > 0 ? 1 : 0;
    const row = cursorLine - windowStart;
    const before = (lines[cursorLine] ?? '').slice(0, cursorCol);
    let rowsBefore = 0;
    for (let index = windowStart; index < cursorLine; index += 1) {
      const lineWidth = stringWidth(lines[index] ?? '');
      rowsBefore += Math.max(1, Math.ceil(lineWidth / Math.max(1, wrapWidth)));
    }
    const offset = cursorOffset(before, row, hintOffset, wrapWidth, rowsBefore);
    setCursorPosition({ x: x + offset.x, y: y + offset.y });
    return () => {
      setCursorPosition(undefined);
    };
  }, [columns, disabled, cursorCol, cursorLine, lines, setCursorPosition, windowStart]);

  return (
    <Box ref={boxRef} flexDirection="column">
      {windowStart > 0 ? <Text dimColor>↑ {windowStart} 行</Text> : null}
      {visibleLines.map((line, index) => {
        const absoluteLine = windowStart + index;
        const isCursorLine = !disabled && absoluteLine === cursorLine;
        if (isCursorLine && value.length === 0) {
          return (
            <Text key={absoluteLine} wrap="wrap">
              <Text dimColor>{placeholder}</Text>
            </Text>
          );
        }
        return (
          <Text key={absoluteLine} wrap="wrap" dimColor={disabled}>
            {line.length > 0 ? line : ' '}
          </Text>
        );
      })}
      {windowEnd < lines.length ? <Text dimColor>↓ {lines.length - windowEnd} 行</Text> : null}
    </Box>
  );
}
