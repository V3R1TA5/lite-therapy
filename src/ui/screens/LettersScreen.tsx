import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { LetterRecord } from '../../db/repositories/postSessionRepository.js';
import { messages } from '../../i18n/zh-CN.js';
import type { AppService } from '../../services/appService.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { formatClock } from '../format.js';

export interface LettersScreenProps {
  service: AppService;
  onBack: () => void;
}

export function LettersScreen(props: LettersScreenProps) {
  const { service, onBack } = props;
  const [letters, setLetters] = useState<LetterRecord[]>(() => service.listLetters(50));
  const [active, setActive] = useState<LetterRecord | null>(null);
  const timezone = service.getConfig()?.profile.timezone ?? 'UTC';

  useInput((_input, key) => {
    if (!key.escape) {
      return;
    }
    if (active !== null) {
      setActive(null);
    } else {
      onBack();
    }
  });

  if (active !== null) {
    return (
      <ScreenFrame title={messages.letters.title} footer={messages.letters.readFooter}>
        <Text dimColor>{formatClock(active.createdAt, timezone)}</Text>
        <Box marginTop={1}>
          <Text wrap="wrap">{active.content}</Text>
        </Box>
      </ScreenFrame>
    );
  }

  if (letters.length === 0) {
    return (
      <ScreenFrame title={messages.letters.title} footer={messages.letters.footer}>
        <Text wrap="wrap">{messages.letters.empty}</Text>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame title={messages.letters.title} footer={messages.letters.footer}>
      <SelectList
        key="letters-list"
        options={letters.map((letter) => ({
          value: letter.id,
          label:
            (letter.readAt === null ? messages.letters.unread : messages.letters.read) +
            ' · ' +
            formatClock(letter.createdAt, timezone) +
            ' · ' +
            (service.getSession(letter.sessionId)?.title ?? ''),
          hint: messages.letters.preview(letter.content),
        }))}
        onSelect={(letterId) => {
          const letter = letters.find((item) => item.id === letterId);
          if (letter === undefined) {
            return;
          }
          service.markLetterRead(letter.id);
          const readAt = letter.readAt ?? new Date().toISOString();
          setLetters((current) =>
            current.map((item) => (item.id === letter.id ? { ...item, readAt } : item)),
          );
          setActive({ ...letter, readAt });
        }}
      />
    </ScreenFrame>
  );
}
