import { Box, Text } from 'ink';
import { cleanup, render } from 'ink-testing-library';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cursorOffset, MultilineInput } from '../src/ui/MultilineInput.js';

function Harness() {
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState('');
  return (
    <Box flexDirection="column">
      <MultilineInput
        value={value}
        onChange={setValue}
        onSubmit={(next) => {
          setSubmitted(next);
          setValue('');
        }}
      />
      <Text>submitted:{submitted}</Text>
    </Box>
  );
}

function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 40);
  });
}

afterEach(() => {
  cleanup();
});

describe('MultilineInput', () => {
  it('types Chinese text and submits on Enter', async () => {
    const { stdin, lastFrame } = render(<Harness />);

    stdin.write('你好');
    await tick();
    expect(lastFrame()).toContain('你好');

    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('submitted:你好');
  });

  it('inserts a newline on Ctrl+J and keeps both lines', async () => {
    const { stdin, lastFrame } = render(<Harness />);

    stdin.write('第一行');
    await tick();
    stdin.write('\n');
    await tick();
    stdin.write('第二行');
    await tick();
    stdin.write('\r');
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('submitted:第一行');
    expect(frame).toContain('第二行');
  });

  it('deletes the previous character on backspace', async () => {
    const { stdin, lastFrame } = render(<Harness />);

    stdin.write('abc');
    await tick();
    stdin.write('\x7f');
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('ab');
    expect(frame).not.toContain('abc');
  });

  it('ignores an empty submit', async () => {
    const { stdin, lastFrame } = render(<Harness />);

    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('submitted:');
  });

  it('computes wide-character cursor columns and hint rows', () => {
    expect(cursorOffset('你好a', 2)).toEqual({ x: 5, y: 2 });
    expect(cursorOffset('', 0, 1)).toEqual({ x: 0, y: 1 });
    expect(cursorOffset('abcdef', 0, 0, 4)).toEqual({ x: 2, y: 1 });
    expect(cursorOffset('abcdefgh', 0, 0, 4, 1)).toEqual({ x: 0, y: 3 });
  });
});
