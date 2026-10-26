import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import {
  MEMORY_KINDS,
  type MemoryCardRecord,
  type MemoryKind,
} from '../../db/repositories/memoryRepository.js';
import { messages } from '../../i18n/zh-CN.js';
import type { AppService } from '../../services/appService.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { SingleLineInput } from '../components/SingleLineInput.js';
import { errorMessage } from '../errorMessage.js';
import { uiColor } from '../theme.js';

export interface MemoriesScreenProps {
  service: AppService;
  onBack: () => void;
}

type Mode = 'list' | 'detail' | 'edit' | 'deleteConfirm' | 'forget' | 'forgetSession' | 'history';

function kindLabel(kind: MemoryCardRecord['kind']): string {
  return (messages.memory.kinds as Record<string, string>)[kind] ?? kind;
}

function sensitivityLabel(value: MemoryCardRecord['sensitivity']): string {
  return (messages.memory.sensitivities as Record<string, string>)[value] ?? value;
}

export function MemoriesScreen(props: MemoriesScreenProps) {
  const { service, onBack } = props;
  const [cards, setCards] = useState<MemoryCardRecord[]>(() => service.listMemoryCards());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  const [editText, setEditText] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [filterKind, setFilterKind] = useState<MemoryKind | 'all'>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<string | null>(null);

  const tags = [...new Set(cards.flatMap((card) => card.tags))];
  const sessionIds = [
    ...new Set(cards.map((card) => card.sourceSessionId).filter((id): id is string => id !== null)),
  ];
  const visibleCards = cards.filter(
    (card) =>
      (tagFilter === null || card.tags.includes(tagFilter)) &&
      (sessionFilter === null || card.sourceSessionId === sessionFilter),
  );
  const active = cards.find((card) => card.id === activeId) ?? null;
  const sources = active === null ? null : service.getMemorySources(active.id);
  const sourceSessionId = sources?.sessionId ?? null;
  const sourceCount =
    sourceSessionId === null ? 0 : service.countMemoriesForSession(sourceSessionId);
  const revisions = active === null ? [] : service.listMemoryRevisions(active.id);

  const refresh = (keepId?: string) => {
    setCards(service.listMemoryCards(filterKind === 'all' ? undefined : filterKind));
    if (keepId !== undefined) {
      setActiveId(keepId);
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      if (mode === 'list') {
        onBack();
      } else if (mode === 'detail') {
        setMode('list');
        setActiveId(null);
      } else if (mode === 'deleteConfirm') {
        setMode('detail');
      } else if (mode === 'forget') {
        setMode('list');
      } else if (mode === 'forgetSession') {
        setMode('detail');
      } else if (mode === 'history') {
        setMode('detail');
      }
      return;
    }
    if (mode !== 'list') {
      return;
    }
    if (input === 'f') {
      const filters: Array<MemoryKind | 'all'> = ['all', ...MEMORY_KINDS];
      const next = filters[(filters.indexOf(filterKind) + 1) % filters.length] ?? 'all';
      setFilterKind(next);
      setTagFilter(null);
      setSessionFilter(null);
      setCards(service.listMemoryCards(next === 'all' ? undefined : next));
      setActiveId(null);
    } else if (input === 't' && tags.length > 0) {
      const options = [null, ...tags];
      const next = options[(options.indexOf(tagFilter) + 1) % options.length] ?? null;
      setTagFilter(next);
      setActiveId(null);
    } else if (input === 's' && sessionIds.length > 0) {
      const options = [null, ...sessionIds];
      const next = options[(options.indexOf(sessionFilter) + 1) % options.length] ?? null;
      setSessionFilter(next);
      setActiveId(null);
    } else if (input === 'x' && visibleCards.length > 0) {
      setMode('forget');
    }
  });

  if (mode === 'edit' && active !== null) {
    return (
      <ScreenFrame title={messages.memory.editTitle} footer={messages.memory.editHint}>
        <Text wrap="wrap">{active.text}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={editText}
            onChange={setEditText}
            onSubmit={(value) => {
              try {
                service.updateMemoryText(active.id, value);
                setNotice(messages.memory.saved);
                setMode('detail');
                refresh(active.id);
              } catch (updateError) {
                setError(errorMessage(updateError));
              }
            }}
            onEscape={() => {
              setMode('detail');
              setError('');
            }}
            placeholder={active.text}
          />
        </Box>
        {error.length > 0 ? <Text color={uiColor('danger')}>{error}</Text> : null}
      </ScreenFrame>
    );
  }

  if (mode === 'forgetSession' && sourceSessionId !== null) {
    return (
      <ScreenFrame title={messages.memory.forgetSessionTitle} footer={messages.memory.detailFooter}>
        <Text wrap="wrap">{messages.memory.forgetSessionBody}</Text>
        <Box marginTop={1}>
          <SelectList
            key="memory-forget-session"
            options={[
              { value: 'delete' as const, label: messages.memory.forgetConfirm },
              { value: 'cancel' as const, label: messages.memory.forgetCancel },
            ]}
            onSelect={(value) => {
              if (value === 'delete') {
                service.forgetMemoriesForSession(sourceSessionId);
                setNotice(messages.memory.forgotSession);
                setActiveId(null);
                setMode('list');
                refresh();
              } else {
                setMode('detail');
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (mode === 'history' && active !== null) {
    return (
      <ScreenFrame title={messages.memory.historyTitle} footer="Esc 返回记忆详情">
        {revisions.length === 0 ? (
          <Text>{messages.memory.historyEmpty}</Text>
        ) : (
          revisions.map((revision) => (
            <Box key={revision.id} flexDirection="column" marginBottom={1}>
              <Text dimColor>{revision.changedAt.slice(0, 19).replace('T', ' ')}</Text>
              <Text dimColor>{messages.memory.historyPrevious}</Text>
              <Text wrap="wrap">{revision.previousText}</Text>
              <Text dimColor>{messages.memory.historyNew}</Text>
              <Text wrap="wrap">{revision.newText}</Text>
            </Box>
          ))
        )}
        <Box marginTop={1}>
          <SelectList
            key="memory-history-back"
            options={[{ value: 'back' as const, label: messages.memory.historyBack }]}
            onSelect={() => setMode('detail')}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (mode === 'forget') {
    return (
      <ScreenFrame title={messages.memory.forgetTitle} footer={messages.memory.detailFooter}>
        <Text wrap="wrap">{messages.memory.forgetBody}</Text>
        <Box marginTop={1}>
          <SelectList
            key="memory-forget"
            options={[
              {
                value: 'filtered' as const,
                label: messages.memory.forgetFiltered(visibleCards.length),
              },
              { value: 'all' as const, label: messages.memory.forgetAll },
              { value: 'cancel' as const, label: messages.memory.forgetCancel },
            ]}
            onSelect={(value) => {
              if (value === 'filtered') {
                service.deleteMemoryCards(visibleCards.map((card) => card.id));
                setNotice(messages.memory.forgotSome);
                setActiveId(null);
                setMode('list');
                refresh();
              } else if (value === 'all') {
                service.clearMemoryCards();
                setNotice(messages.memory.forgotAll);
                setActiveId(null);
                setMode('list');
                refresh();
              } else {
                setMode('list');
              }
            }}
          />
        </Box>
        {notice.length > 0 ? <Text color={uiColor('success')}>{notice}</Text> : null}
      </ScreenFrame>
    );
  }

  if (mode === 'deleteConfirm' && active !== null) {
    return (
      <ScreenFrame title={messages.memory.deleteTitle} footer={messages.memory.detailFooter}>
        <Text wrap="wrap">{messages.memory.deleteBody}</Text>
        <Box marginTop={1}>
          <SelectList
            key="memory-delete-confirm"
            options={[
              { value: 'delete' as const, label: messages.memory.deleteYes },
              { value: 'cancel' as const, label: messages.memory.cancel },
            ]}
            onSelect={(value) => {
              if (value === 'delete') {
                service.deleteMemory(active.id);
                setNotice(messages.memory.deleted);
                setActiveId(null);
                setMode('list');
                refresh();
              } else {
                setMode('detail');
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (mode === 'detail' && active !== null) {
    return (
      <ScreenFrame title={messages.memory.detailTitle} footer={messages.memory.detailFooter}>
        {notice.length > 0 ? <Text color={uiColor('success')}>{notice}</Text> : null}
        <Text wrap="wrap" bold>
          {active.text}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            {messages.memory.kind}：{kindLabel(active.kind)}
          </Text>
          <Text>
            {messages.memory.confidence}：{active.confidence.toFixed(2)}
          </Text>
          <Text>
            {messages.memory.sensitivity}：{sensitivityLabel(active.sensitivity)}
          </Text>
          <Text>
            {messages.memory.tags}：{active.tags.length > 0 ? active.tags.join('、') : '无'}
          </Text>
          <Text>
            {messages.memory.recalls(active.recallCount)}
            {active.lastRecalledAt !== null ? ' · ' + active.lastRecalledAt.slice(0, 10) : ''}
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>{messages.memory.source}</Text>
          <Text dimColor>{sources?.sessionTitle ?? messages.memory.sourceMissing}</Text>
          {sources !== null && sources.messages.length > 0 ? (
            sources.messages.map((message) => (
              <Text key={message.id} wrap="wrap" dimColor>
                · {message.role === 'user' ? '来访者' : '知微'}：{message.excerpt}
              </Text>
            ))
          ) : (
            <Text dimColor>{messages.memory.noMessages}</Text>
          )}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>{messages.memory.recallHistory}</Text>
          {sources !== null && sources.recalls.length > 0 ? (
            sources.recalls.map((recall) => (
              <Text key={recall.id} wrap="wrap" dimColor>
                · {service.getSession(recall.sessionId)?.title ?? recall.sessionId.slice(0, 8)} ·{' '}
                {messages.memory.recallScore} {recall.score.toFixed(2)} ·{' '}
                {recall.createdAt.slice(0, 10)}
              </Text>
            ))
          ) : (
            <Text dimColor>{messages.memory.noRecalls}</Text>
          )}
        </Box>
        {error.length > 0 ? <Text color={uiColor('danger')}>{error}</Text> : null}
        <Box marginTop={1}>
          <SelectList
            key="memory-detail-actions"
            options={[
              { value: 'edit' as const, label: messages.memory.edit },
              { value: 'history' as const, label: messages.memory.history },
              ...(active.uncertain
                ? [{ value: 'confirm' as const, label: messages.memory.confirm }]
                : []),
              { value: 'archive' as const, label: messages.memory.archive },
              ...(sourceSessionId !== null && sourceCount > 0
                ? [
                    {
                      value: 'forgetSession' as const,
                      label: messages.memory.forgetSession(sourceCount),
                    },
                  ]
                : []),
              { value: 'delete' as const, label: messages.memory.delete },
              { value: 'back' as const, label: messages.memory.back },
            ]}
            onSelect={(value) => {
              if (value === 'edit') {
                setEditText(active.text);
                setError('');
                setMode('edit');
              } else if (value === 'history') {
                setMode('history');
              } else if (value === 'confirm') {
                service.confirmMemory(active.id);
                setNotice(messages.memory.confirmed);
                refresh(active.id);
              } else if (value === 'archive') {
                service.archiveMemory(active.id);
                setNotice(messages.memory.archived);
                setActiveId(null);
                setMode('list');
                refresh();
              } else if (value === 'forgetSession') {
                setMode('forgetSession');
              } else if (value === 'delete') {
                setMode('deleteConfirm');
              } else {
                setMode('list');
                setActiveId(null);
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (cards.length === 0) {
    return (
      <ScreenFrame title={messages.memory.title} footer={messages.memory.footer}>
        {notice.length > 0 ? <Text color={uiColor('success')}>{notice}</Text> : null}
        <Text wrap="wrap">{messages.memory.empty}</Text>
      </ScreenFrame>
    );
  }

  const filterLine = [
    messages.memory.filter(filterKind === 'all' ? messages.memory.allKinds : kindLabel(filterKind)),
    tagFilter !== null ? messages.memory.tags + '：' + tagFilter : null,
    sessionFilter !== null
      ? messages.memory.source +
        '：' +
        (service.getSession(sessionFilter)?.title ?? sessionFilter.slice(0, 8))
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  if (visibleCards.length === 0) {
    return (
      <ScreenFrame title={messages.memory.title} footer={messages.memory.footer}>
        {notice.length > 0 ? <Text color={uiColor('success')}>{notice}</Text> : null}
        <Text dimColor>{filterLine}</Text>
        <Text wrap="wrap">{messages.memory.filteredEmpty}</Text>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame title={messages.memory.title} footer={messages.memory.footer}>
      {notice.length > 0 ? <Text color={uiColor('success')}>{notice}</Text> : null}
      <Text dimColor>{filterLine}</Text>
      <SelectList
        key="memory-list"
        options={visibleCards.map((card) => ({
          value: card.id,
          label: kindLabel(card.kind) + ' · ' + card.text,
          hint:
            sensitivityLabel(card.sensitivity) +
            (card.uncertain ? ' · 待确认' : '') +
            (card.tags.length > 0 ? ' · ' + card.tags.join('、') : ''),
        }))}
        onSelect={(id) => {
          setActiveId(id);
          setNotice('');
          setMode('detail');
        }}
      />
    </ScreenFrame>
  );
}
