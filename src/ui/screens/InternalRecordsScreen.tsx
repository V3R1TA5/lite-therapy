import { Box, Text, useInput, useWindowSize } from 'ink';
import { useMemo, useState } from 'react';
import { messages } from '../../i18n/zh-CN.js';
import type { AppService } from '../../services/appService.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { uiColor } from '../theme.js';

export interface InternalRecordsScreenProps {
  service: AppService;
  sessionId: string;
  onBack: () => void;
}

interface RecordItem {
  key: 'note' | 'formulation' | 'supervision' | 'memo';
  label: string;
  content: string;
}

function wrapLines(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    for (let index = 0; index < paragraph.length; index += width) {
      lines.push(paragraph.slice(index, index + width));
    }
  }
  return lines;
}

export function InternalRecordsScreen(props: InternalRecordsScreenProps) {
  const { service, sessionId, onBack } = props;
  const { columns, rows } = useWindowSize();
  const [active, setActive] = useState<RecordItem | null>(null);
  const [viewStart, setViewStart] = useState(0);

  const items = useMemo<RecordItem[]>(() => {
    const artifacts = service.getPostSessionArtifacts(sessionId);
    const result: RecordItem[] = [];
    if (artifacts.note !== null) {
      result.push({
        key: 'note',
        label: messages.records.note,
        content: artifacts.note.content,
      });
    }
    if (artifacts.formulation !== null) {
      result.push({
        key: 'formulation',
        label: messages.records.formulation,
        content: artifacts.formulation.content,
      });
    }
    if (artifacts.supervision !== null) {
      result.push({
        key: 'supervision',
        label: messages.records.supervision,
        content: artifacts.supervision.content,
      });
    }
    if (artifacts.memo !== null) {
      result.push({
        key: 'memo',
        label: messages.records.memo,
        content: artifacts.memo.content,
      });
    }
    return result;
  }, [service, sessionId]);

  const width = Math.max(20, columns - 6);
  const viewport = Math.max(5, rows - 12);
  const lines = useMemo(
    () => (active === null ? [] : wrapLines(active.content, width)),
    [active, width],
  );
  const maxStart = Math.max(0, lines.length - viewport);
  const visible = lines.slice(viewStart, viewStart + viewport);

  useInput((_input, key) => {
    if (key.escape) {
      if (active !== null) {
        setActive(null);
        setViewStart(0);
      } else {
        onBack();
      }
      return;
    }
    if (active === null) {
      return;
    }
    if (key.pageUp || key.upArrow) {
      setViewStart((current) => Math.max(0, current - (key.pageUp ? viewport : 1)));
    } else if (key.pageDown || key.downArrow) {
      setViewStart((current) => Math.min(maxStart, current + (key.pageDown ? viewport : 1)));
    }
  });

  if (active !== null) {
    return (
      <ScreenFrame title={messages.records.title} footer={messages.records.readFooter}>
        <Text color={uiColor('warning')} wrap="wrap">
          {messages.records.warning}
        </Text>
        <Box marginTop={1}>
          <Text bold>{active.label}</Text>
        </Box>
        <Box marginTop={1}>
          <Text wrap="wrap">{visible.join('\n')}</Text>
        </Box>
        {viewStart >= maxStart ? <Text dimColor>{messages.records.endOfContent}</Text> : null}
      </ScreenFrame>
    );
  }

  if (items.length === 0) {
    return (
      <ScreenFrame title={messages.records.title} footer={messages.records.footer}>
        <Text>{messages.records.empty}</Text>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame title={messages.records.title} footer={messages.records.footer}>
      <Text color={uiColor('warning')} wrap="wrap">
        {messages.records.warning}
      </Text>
      <Box marginTop={1}>
        <SelectList
          key="internal-records"
          options={items.map((item) => ({ value: item.key, label: item.label }))}
          onSelect={(key) => {
            const item = items.find((candidate) => candidate.key === key);
            if (item !== undefined) {
              setActive(item);
              setViewStart(0);
            }
          }}
        />
      </Box>
    </ScreenFrame>
  );
}
