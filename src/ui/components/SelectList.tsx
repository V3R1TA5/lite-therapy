import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { uiColor } from '../theme.js';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface SelectListProps<T extends string> {
  options: ReadonlyArray<SelectOption<T>>;
  onSelect: (value: T) => void;
  onHighlight?: (value: T) => void;
  onEscape?: () => void;
  isActive?: boolean;
  initialIndex?: number;
}

function firstEnabled<T extends string>(options: ReadonlyArray<SelectOption<T>>): number {
  const index = options.findIndex((option) => !option.disabled);
  return Math.max(index, 0);
}

function stepEnabled<T extends string>(
  options: ReadonlyArray<SelectOption<T>>,
  current: number,
  direction: 1 | -1,
): number {
  if (options.length === 0) {
    return 0;
  }
  let next = current;
  for (let attempt = 0; attempt < options.length; attempt += 1) {
    next = (next + direction + options.length) % options.length;
    if (!options[next]?.disabled) {
      return next;
    }
  }
  return current;
}

export function SelectList<T extends string>(props: SelectListProps<T>) {
  const { options, onSelect, onHighlight, onEscape, isActive = true, initialIndex } = props;
  const [index, setIndex] = useState(() => initialIndex ?? firstEnabled(options));
  const onHighlightRef = useRef(onHighlight);
  onHighlightRef.current = onHighlight;

  useEffect(() => {
    const option = options[index];
    if (option !== undefined && !option.disabled) {
      onHighlightRef.current?.(option.value);
    }
  }, [index, options]);

  useEffect(() => {
    setIndex((current) => {
      if (current >= options.length) {
        return firstEnabled(options);
      }
      return options[current]?.disabled ? firstEnabled(options) : current;
    });
  }, [options]);

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setIndex((current) => stepEnabled(options, current, -1));
        return;
      }
      if (key.downArrow) {
        setIndex((current) => stepEnabled(options, current, 1));
        return;
      }
      if (key.escape) {
        onEscape?.();
        return;
      }
      if (key.return) {
        const option = options[index];
        if (option && !option.disabled) {
          onSelect(option.value);
        }
      }
    },
    { isActive },
  );

  return (
    <Box flexDirection="column">
      {options.map((option, optionIndex) => {
        const selected = optionIndex === index;
        return (
          <Box key={option.value} flexDirection="column" marginBottom={option.hint ? 1 : 0}>
            <Text
              color={option.disabled ? uiColor('muted') : selected ? uiColor('accent') : undefined}
              dimColor={option.disabled}
              bold={selected && !option.disabled}
            >
              {selected ? '› ' : '  '}
              {option.label}
              {option.disabled ? '（未开放）' : ''}
            </Text>
            {option.hint ? <Text dimColor> {option.hint}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
