import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { SessionRecord } from '../../db/repositories/sessionRepository.js';
import { messages } from '../../i18n/zh-CN.js';
import type { AppService } from '../../services/appService.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { errorMessage } from '../errorMessage.js';
import { formatSessionDate } from '../format.js';
import { uiColor } from '../theme.js';

export interface SessionListScreenProps {
  service: AppService;
  onOpenChat: (sessionId: string) => void;
  onBack: () => void;
}

function statusLabel(status: SessionRecord['status']): string {
  if (status === 'active') {
    return messages.chat.statusActive;
  }
  if (status === 'ended') {
    return messages.chat.statusEnded;
  }
  return messages.chat.statusDraft;
}

export function SessionListScreen(props: SessionListScreenProps) {
  const { service, onOpenChat, onBack } = props;
  const timezone = service.getConfig()?.profile.timezone ?? 'UTC';
  const [sessions, setSessions] = useState<SessionRecord[]>(() => service.listSessions(50));
  const [highlightedId, setHighlightedId] = useState<string | null>(() => sessions[0]?.id ?? null);
  const [deleteTarget, setDeleteTarget] = useState<SessionRecord | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const reload = () => {
    const next = service.listSessions(50);
    setSessions(next);
    setHighlightedId(next[0]?.id ?? null);
  };

  useInput(
    (inputValue, key) => {
      if (deleteTarget !== null) {
        return;
      }
      if (key.escape) {
        onBack();
        return;
      }
      if (inputValue === 'd' && highlightedId !== null) {
        const target = sessions.find((session) => session.id === highlightedId);
        if (target !== undefined) {
          setError('');
          setDeleteTarget(target);
        }
      }
    },
    { isActive: true },
  );

  if (deleteTarget !== null) {
    return (
      <ScreenFrame
        title={messages.sessions.deleteConfirmTitle(deleteTarget.title)}
        footer="Esc 取消"
      >
        <Text>{messages.sessions.deleteConfirmBody}</Text>
        {error.length > 0 ? (
          <Box marginTop={1}>
            <Text color={uiColor('danger')}>{error}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <SelectList
            key="session-delete-confirm"
            options={[
              { value: 'yes', label: messages.sessions.deleteConfirmYes },
              { value: 'no', label: messages.sessions.cancel },
            ]}
            onSelect={(value) => {
              if (value === 'yes') {
                try {
                  service.deleteSession(deleteTarget.id);
                  setDeleteTarget(null);
                  setNotice(messages.sessions.deleted);
                  reload();
                } catch (deleteError) {
                  setError(errorMessage(deleteError));
                }
              } else {
                setDeleteTarget(null);
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (sessions.length === 0) {
    return (
      <ScreenFrame title={messages.sessions.title} footer="Esc 返回">
        <Text dimColor>{messages.sessions.empty}</Text>
        <Box marginTop={1}>
          <SelectList
            key="sessions-empty-back"
            options={[{ value: 'back', label: messages.common.back }]}
            onSelect={() => onBack()}
          />
        </Box>
      </ScreenFrame>
    );
  }

  const options = sessions.map((session) => ({
    value: session.id,
    label:
      '[' +
      statusLabel(session.status) +
      '] ' +
      session.title +
      ' · ' +
      formatSessionDate(session.updatedAt, timezone),
  }));

  return (
    <ScreenFrame title={messages.sessions.title} footer={messages.sessions.footer}>
      {notice.length > 0 ? <Text color={uiColor('success')}>{notice}</Text> : null}
      {error.length > 0 ? <Text color={uiColor('danger')}>{error}</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        <SelectList
          key="session-list"
          options={options}
          initialIndex={Math.max(
            0,
            sessions.findIndex((session) => session.id === highlightedId),
          )}
          onHighlight={setHighlightedId}
          onSelect={(sessionId) => onOpenChat(sessionId)}
        />
      </Box>
    </ScreenFrame>
  );
}
