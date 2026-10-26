import { Box, Text, useInput, useWindowSize } from 'ink';
import { useCallback, useEffect, useState } from 'react';
import { APP_NAME } from '../../core/version.js';
import type { MessageRecord } from '../../db/repositories/messageRepository.js';
import type { SessionRecord } from '../../db/repositories/sessionRepository.js';
import { messages } from '../../i18n/zh-CN.js';
import type { AppService } from '../../services/appService.js';
import type { ChatCallbacks, ChatService } from '../../services/chatService.js';
import { type CrisisResources, EMPTY_CRISIS_RESOURCES } from '../../services/crisisResources.js';
import type { SafetyEvaluation } from '../../services/safetyService.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { SingleLineInput } from '../components/SingleLineInput.js';
import { errorMessage } from '../errorMessage.js';
import { formatClock, formatElapsed } from '../format.js';
import { MultilineInput } from '../MultilineInput.js';
import { uiColor } from '../theme.js';
import { CrisisCard } from './CrisisCard.js';

export interface ChatScreenProps {
  service: AppService;
  sessionId: string;
  onExit: (notice?: string) => void;
  onPostSession?: (sessionId: string) => void;
  onLock: (notice?: string) => void;
  onQuit: () => void;
}

type Menu =
  | 'none'
  | 'actions'
  | 'endConfirm'
  | 'deleteConfirm'
  | 'exportOptions'
  | 'exportPassword'
  | 'exportResult'
  | 'quitConfirm';

function statusLabel(status: SessionRecord['status']): string {
  if (status === 'active') {
    return messages.chat.statusActive;
  }
  if (status === 'ended') {
    return messages.chat.statusEnded;
  }
  return messages.chat.statusDraft;
}

function MessageRow(props: { message: MessageRecord; timezone: string }) {
  const { message, timezone } = props;
  const isUser = message.role === 'user';
  const streaming = message.status === 'streaming';
  const body =
    message.content.length === 0 && streaming ? (
      <Text color={uiColor('accent')}>▌</Text>
    ) : (
      <Text wrap="wrap">
        {message.content}
        {streaming ? <Text color={uiColor('accent')}>▌</Text> : null}
      </Text>
    );

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={isUser ? uiColor('user') : uiColor('assistant')}>
        {isUser ? '你' : '知微'} <Text dimColor>{formatClock(message.createdAt, timezone)}</Text>
      </Text>
      {body}
      {message.status === 'interrupted' ? (
        <Text color={uiColor('warning')}>{messages.chat.interrupted}</Text>
      ) : null}
      {message.status === 'failed' ? (
        <Text color={uiColor('danger')}>{messages.chat.failed}</Text>
      ) : null}
    </Box>
  );
}

export function ChatScreen(props: ChatScreenProps) {
  const { service, sessionId, onExit, onPostSession, onLock, onQuit } = props;
  const { columns } = useWindowSize();

  const [session, setSession] = useState<SessionRecord | null>(() => service.getSession(sessionId));
  const [chatMessages, setChatMessages] = useState<MessageRecord[]>(() =>
    service.listSessionMessages(sessionId),
  );
  const [chat, setChat] = useState<ChatService | null>(null);
  const [chatError, setChatError] = useState('');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [menu, setMenu] = useState<Menu>('none');
  const [password, setPassword] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportPath, setExportPath] = useState('');
  const [exportChoices, setExportChoices] = useState({
    format: 'markdown' as 'markdown' | 'json',
    letter: true,
    memo: false,
    memory: false,
    internal: false,
  });
  const [showSidebar, setShowSidebar] = useState(true);
  const [windowEnd, setWindowEnd] = useState(() => chatMessages.length);
  const [follow, setFollow] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [riskCard, setRiskCard] = useState<SafetyEvaluation | null>(null);
  const [showResources, setShowResources] = useState(false);
  const [riskBanner, setRiskBanner] = useState(false);
  const [crisisResources, setCrisisResources] = useState<CrisisResources>(EMPTY_CRISIS_RESOURCES);
  const [crisisPath, setCrisisPath] = useState('');
  const [crisisError, setCrisisError] = useState('');

  const readOnly = session?.status === 'ended';
  const timezone = service.getConfig()?.profile.timezone ?? 'UTC';
  const profile = service.getActiveModelProfile();

  const refresh = useCallback(() => {
    setSession(service.getSession(sessionId));
    setChatMessages(service.listSessionMessages(sessionId));
  }, [service, sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loaded = service.getCrisisResources();
    setCrisisResources(loaded.resources);
    setCrisisPath(loaded.path);
    setCrisisError(loaded.error ?? '');
  }, [service]);

  useEffect(() => {
    if (session !== null && session.riskState !== 'none') {
      setRiskBanner(true);
    }
  }, [session]);

  useEffect(() => {
    if (readOnly === true) {
      setChat(null);
      return;
    }
    let created: ChatService | null = null;
    try {
      created = service.createChat(sessionId);
      setChat(created);
      setChatError('');
    } catch (chatCreationError) {
      setChat(null);
      setChatError(errorMessage(chatCreationError));
    }
    return () => {
      created?.abort();
    };
  }, [service, sessionId, readOnly]);

  useEffect(() => {
    if (follow) {
      setWindowEnd(chatMessages.length);
    } else {
      setWindowEnd((current) => Math.min(current, chatMessages.length));
    }
  }, [chatMessages.length, follow]);

  const upsert = useCallback((message: MessageRecord) => {
    setChatMessages((current) => {
      const index = current.findIndex((item) => item.id === message.id);
      if (index < 0) {
        return [...current, message];
      }
      const next = [...current];
      next[index] = message;
      return next;
    });
  }, []);

  const runStream = async (mode: 'send' | 'retry', text?: string) => {
    if (chat === null || streaming) {
      return;
    }
    setError('');
    setNotice('');
    setFollow(true);
    let assistantId: string | null = null;
    const callbacks: ChatCallbacks = {
      onUserMessage: upsert,
      onAssistantStart: (message) => {
        assistantId = message.id;
        upsert(message);
      },
      onDelta: (_text, accumulated) => {
        if (assistantId === null) {
          return;
        }
        setChatMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: accumulated } : message,
          ),
        );
      },
      onDone: upsert,
      onAborted: upsert,
      onError: (message, record) => {
        setError(message);
        if (record !== null) {
          upsert(record);
        }
      },
      onRisk: (evaluation) => {
        if (evaluation.level !== 'none') {
          const contexts =
            evaluation.contexts ?? (evaluation.context !== undefined ? [evaluation.context] : []);
          const thirdPartyOnly =
            evaluation.level === 'concern' &&
            contexts.includes('third_party') &&
            !contexts.includes('self');
          if (thirdPartyOnly) {
            setNotice(messages.chat.thirdPartyNotice);
            setRiskBanner(true);
            return;
          }
          const negatedOnly =
            evaluation.level === 'concern' &&
            contexts.includes('negated') &&
            !contexts.includes('self') &&
            !contexts.includes('third_party');
          if (negatedOnly) {
            setNotice(messages.chat.negatedNotice);
            setRiskBanner(true);
            return;
          }
          setRiskCard(evaluation);
          setShowResources(false);
          setRiskBanner(true);
        }
      },
    };

    setStreaming(true);
    try {
      const result =
        mode === 'retry'
          ? await chat.retryLast(sessionId, callbacks)
          : await chat.send(sessionId, text ?? '', callbacks);
      if (result.status === 'aborted') {
        setNotice(messages.chat.stopped);
      } else if (result.status === 'error' && result.error !== undefined) {
        setError(result.error);
      }
      refresh();
    } catch (streamError) {
      setError(errorMessage(streamError));
      refresh();
    } finally {
      setStreaming(false);
    }
  };

  const retry = () => {
    if (streaming || readOnly === true || chat === null) {
      return;
    }
    if (chatMessages.at(-1)?.role === 'assistant') {
      setChatMessages((current) => current.slice(0, -1));
    }
    void runStream('retry');
  };

  const submitExport = async (submittedPassword: string = password) => {
    setPassword(submittedPassword);
    if (submittedPassword.length === 0) {
      setError('请输入启动密码。');
      return;
    }
    setExporting(true);
    setError('');
    try {
      const path = await service.exportSession(sessionId, submittedPassword, {
        includeLetter: exportChoices.letter,
        includeMemo: exportChoices.memo,
        includeMemory: exportChoices.memory,
        includeInternal: exportChoices.internal,
        format: exportChoices.format,
      });
      setExportPath(path);
      setPassword('');
      setMenu('exportResult');
    } catch (exportError) {
      setError(errorMessage(exportError));
    } finally {
      setExporting(false);
    }
  };

  const confirmEnd = () => {
    try {
      const result = service.endSession(sessionId);
      if (result.deleted) {
        onExit(messages.chat.emptyDeletedNotice);
      } else if (onPostSession !== undefined) {
        onPostSession(sessionId);
      } else {
        onExit(messages.chat.endedNotice);
      }
    } catch (endError) {
      setError(errorMessage(endError));
      setMenu('actions');
    }
  };

  const confirmDelete = () => {
    try {
      service.deleteSession(sessionId);
      onExit(messages.chat.deletedNotice);
    } catch (deleteError) {
      setError(errorMessage(deleteError));
      setMenu('actions');
    }
  };

  const dismissRisk = () => {
    setRiskCard(null);
    setShowResources(false);
    setRiskBanner(true);
  };

  useInput(
    (inputValue, key) => {
      if (riskCard !== null) {
        return;
      }
      if (key.ctrl && inputValue === 'l') {
        onLock(messages.lock.manualNotice);
        return;
      }
      if (key.ctrl && inputValue === 'c') {
        if (streaming) {
          chat?.abort();
          setNotice(messages.chat.stopped);
        } else {
          onExit();
        }
        return;
      }
      if (menu !== 'none') {
        if (key.escape) {
          setError('');
          setMenu(menu === 'actions' ? 'none' : 'actions');
        }
        return;
      }
      if (key.ctrl && inputValue === 'b') {
        setShowSidebar((current) => !current);
        return;
      }
      if (key.ctrl && inputValue === 'k') {
        if (streaming) {
          chat?.abort();
          setNotice(messages.chat.stopped);
          return;
        }
        setMenu('actions');
        return;
      }
      if (key.ctrl && inputValue === 'q') {
        setMenu('quitConfirm');
        return;
      }
      if (key.escape) {
        if (streaming) {
          chat?.abort();
          setNotice(messages.chat.stopped);
        }
        return;
      }
      if (key.ctrl && inputValue === 'r') {
        retry();
        return;
      }
      if (key.pageUp) {
        setFollow(false);
        setWindowEnd((current) => Math.max(1, current - 1));
        return;
      }
      if (key.pageDown) {
        const next = Math.min(chatMessages.length, windowEnd + 1);
        setWindowEnd(next);
        if (next >= chatMessages.length) {
          setFollow(true);
        }
        return;
      }
      if (key.ctrl && key.end) {
        setFollow(true);
        setWindowEnd(chatMessages.length);
      }
    },
    { isActive: true },
  );

  if (session === null) {
    return (
      <ScreenFrame title={messages.chat.title} footer="Enter 返回">
        <Text color={uiColor('danger')}>{messages.chat.sessionMissing}</Text>
        <Box marginTop={1}>
          <SelectList
            key="chat-session-missing-back"
            options={[{ value: 'back', label: messages.common.back }]}
            onSelect={() => onExit()}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (riskCard !== null) {
    return (
      <CrisisCard
        level={riskCard.level}
        resources={crisisResources}
        resourcesPath={crisisPath}
        resourcesError={crisisError.length > 0 ? crisisError : undefined}
        showingResources={showResources}
        onSafe={dismissRisk}
        onContinue={dismissRisk}
        onViewResources={() => setShowResources(true)}
        onBackFromResources={() => setShowResources(false)}
        onEnd={() => {
          setRiskCard(null);
          confirmEnd();
        }}
      />
    );
  }

  const menuError =
    error.length > 0 ? (
      <Box marginTop={1}>
        <Text color={uiColor('danger')}>{error}</Text>
      </Box>
    ) : null;

  if (menu === 'actions') {
    const userMessageCount = chatMessages.filter((message) => message.role === 'user').length;
    const options = [
      {
        value: 'export' as const,
        label: messages.chat.menuExport,
        disabled: userMessageCount === 0,
      },
      ...(readOnly === true
        ? []
        : [{ value: 'end' as const, label: messages.chat.menuEnd, disabled: false }]),
      { value: 'delete' as const, label: messages.chat.menuDelete },
      { value: 'lock' as const, label: messages.chat.menuLock },
      { value: 'back' as const, label: messages.chat.menuBack },
      { value: 'cancel' as const, label: messages.chat.menuCancel },
    ];
    return (
      <ScreenFrame
        title={messages.chat.menuTitle}
        subtitle={session.title}
        footer="↑↓ 选择 · Enter 确认 · Esc 返回对话"
      >
        {notice.length > 0 ? <Text color={uiColor('warning')}>{notice}</Text> : null}
        {menuError}
        <Box marginTop={1}>
          <SelectList
            key="chat-actions"
            options={options}
            onSelect={(value) => {
              if (value === 'export') {
                setError('');
                setPassword('');
                setPassword('');
                setMenu('exportOptions');
              } else if (value === 'end') {
                setMenu('endConfirm');
              } else if (value === 'delete') {
                setError('');
                setMenu('deleteConfirm');
              } else if (value === 'lock') {
                onLock(messages.lock.manualNotice);
              } else if (value === 'back') {
                onExit();
              } else {
                setMenu('none');
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (menu === 'endConfirm') {
    return (
      <ScreenFrame title={messages.chat.endConfirmTitle} subtitle={session.title} footer="Esc 取消">
        <Text>{messages.chat.endConfirmBody}</Text>
        {menuError}
        <Box marginTop={1}>
          <SelectList
            key="chat-end-confirm"
            options={[
              { value: 'yes', label: messages.chat.endConfirmYes },
              { value: 'no', label: messages.chat.cancel },
            ]}
            onSelect={(value) => {
              if (value === 'yes') {
                confirmEnd();
              } else {
                setMenu('actions');
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (menu === 'deleteConfirm') {
    return (
      <ScreenFrame
        title={messages.chat.deleteConfirmTitle}
        subtitle={session.title}
        footer="Esc 取消"
      >
        <Text>{messages.chat.deleteConfirmBody}</Text>
        {menuError}
        <Box marginTop={1}>
          <SelectList
            key="chat-delete-confirm"
            options={[
              { value: 'yes', label: messages.chat.deleteConfirmYes },
              { value: 'no', label: messages.chat.cancel },
            ]}
            onSelect={(value) => {
              if (value === 'yes') {
                confirmDelete();
              } else {
                setMenu('actions');
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (menu === 'exportOptions') {
    const toggleLabel = (enabled: boolean, label: string) => (enabled ? '[x] ' : '[ ] ') + label;
    return (
      <ScreenFrame
        title={messages.chat.exportOptionsTitle}
        subtitle={session.title}
        footer="↑↓ 选择 · Enter 切换/确认 · Esc 返回"
      >
        <Text dimColor wrap="wrap">
          {messages.chat.exportOptionsHint}
        </Text>
        <Box marginTop={1}>
          <SelectList
            key="chat-export-options"
            options={[
              {
                value: 'format' as const,
                label:
                  exportChoices.format === 'json'
                    ? messages.chat.exportFormatJson
                    : messages.chat.exportFormatMarkdown,
              },
              {
                value: 'letter' as const,
                label: toggleLabel(exportChoices.letter, messages.chat.exportIncludeLetter),
              },
              {
                value: 'memo' as const,
                label: toggleLabel(exportChoices.memo, messages.chat.exportIncludeMemo),
              },
              {
                value: 'memory' as const,
                label: toggleLabel(exportChoices.memory, messages.chat.exportIncludeMemory),
              },
              {
                value: 'internal' as const,
                label: toggleLabel(exportChoices.internal, messages.chat.exportIncludeInternal),
              },
              { value: 'continue' as const, label: messages.chat.exportContinue },
              { value: 'cancel' as const, label: messages.chat.exportCancel },
            ]}
            onSelect={(value) => {
              if (value === 'continue') {
                setMenu('exportPassword');
              } else if (value === 'cancel') {
                setMenu('none');
              } else if (value === 'format') {
                setExportChoices((current) => ({
                  ...current,
                  format: current.format === 'json' ? 'markdown' : 'json',
                }));
              } else {
                setExportChoices((current) => ({ ...current, [value]: !current[value] }));
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (menu === 'exportPassword') {
    return (
      <ScreenFrame
        title={messages.chat.exportTitle}
        subtitle={session.title}
        footer="Enter 导出 · Esc 返回"
      >
        <Text dimColor>{messages.chat.exportHint}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={password}
            onChange={setPassword}
            onSubmit={(value) => {
              void submitExport(value);
            }}
            onEscape={() => setMenu('actions')}
            placeholder={messages.chat.exportPlaceholder}
            mask
            disabled={exporting}
          />
        </Box>
        {exporting ? (
          <Box marginTop={1}>
            <Text color={uiColor('warning')}>{messages.chat.exporting}</Text>
          </Box>
        ) : null}
        {menuError}
      </ScreenFrame>
    );
  }

  if (menu === 'quitConfirm') {
    return (
      <ScreenFrame
        title={messages.chat.quitConfirmTitle}
        subtitle={session.title}
        footer="Esc 取消"
      >
        <Text>{messages.chat.quitConfirmBody}</Text>
        <Box marginTop={1}>
          <SelectList
            key="chat-quit-confirm"
            options={[
              { value: 'yes', label: messages.chat.quitConfirmYes },
              { value: 'no', label: messages.chat.quitConfirmNo },
            ]}
            onSelect={(value) => {
              if (value === 'yes') {
                onQuit();
              } else {
                setMenu('none');
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (menu === 'exportResult') {
    return (
      <ScreenFrame title={messages.chat.exportSuccess} subtitle={session.title} footer="Enter 返回">
        <Text wrap="wrap">{exportPath}</Text>
        <Box marginTop={1}>
          <SelectList
            key="chat-export-result"
            options={[
              { value: 'chat', label: messages.chat.exportAgain },
              { value: 'home', label: messages.chat.menuBack },
            ]}
            onSelect={(value) => {
              if (value === 'home') {
                onExit();
              } else {
                setMenu('none');
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  const elapsedReference = session.endedAt !== null ? Date.parse(session.endedAt) : nowMs;
  const resumed = Date.parse(session.resumedAt);
  const elapsedMs = Number.isNaN(resumed) ? 0 : Math.max(0, elapsedReference - resumed);
  const userMessageCount = chatMessages.filter((message) => message.role === 'user').length;
  const visibleMessages = chatMessages.slice(Math.max(0, windowEnd - 60), windowEnd);
  const showSidebarNow = showSidebar && columns >= 96;
  const canType = readOnly !== true && chat !== null && chatError.length === 0;

  return (
    <Box flexDirection="column" width={columns} height="100%" paddingX={1} paddingY={0}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between">
        <Text bold color={uiColor('accent')}>
          {APP_NAME} · {session.title}
        </Text>
        <Text dimColor>
          {messages.chat.aiRole} · {statusLabel(session.status)} · {formatElapsed(elapsedMs)}
        </Text>
      </Box>

      <Box flexDirection="row" flexGrow={1} minHeight={0}>
        <Box
          flexDirection="column"
          flexGrow={1}
          minHeight={0}
          paddingX={1}
          paddingY={1}
          overflow="hidden"
          justifyContent="flex-end"
        >
          {windowEnd < chatMessages.length ? (
            <Text dimColor>{messages.chat.scrollHint(chatMessages.length - windowEnd)}</Text>
          ) : null}
          {visibleMessages.map((message) => (
            <MessageRow key={message.id} message={message} timezone={timezone} />
          ))}
        </Box>

        {showSidebarNow ? (
          <Box
            width={30}
            flexDirection="column"
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
            paddingY={1}
          >
            <Text bold>{messages.chat.sidebarTitle}</Text>
            <Text dimColor>{session.title}</Text>
            <Text>{messages.chat.sidebarStatus + ' ' + statusLabel(session.status)}</Text>
            <Text>
              {messages.chat.sidebarModel +
                ' ' +
                (profile?.model ?? messages.chat.sidebarModelMissing)}
            </Text>
            <Text>{messages.chat.sidebarElapsed + ' ' + formatElapsed(elapsedMs)}</Text>
            <Text>
              {messages.chat.sidebarMessages +
                ' ' +
                userMessageCount +
                ' 轮 / ' +
                chatMessages.length +
                ' 条'}
            </Text>
            <Text dimColor>
              {messages.chat.sidebarMemory + ' ' + messages.chat.sidebarDisabled}
            </Text>
            <Text
              color={riskBanner || session.riskState !== 'none' ? uiColor('warning') : undefined}
              dimColor={!(riskBanner || session.riskState !== 'none')}
            >
              {messages.chat.sidebarSafety +
                ' ' +
                (riskBanner || session.riskState !== 'none'
                  ? messages.chat.sidebarRiskRecorded
                  : messages.chat.sidebarNotTriggered)}
            </Text>
          </Box>
        ) : null}
      </Box>

      {riskBanner ? (
        <Box paddingX={1}>
          <Text color={uiColor('warning')}>{messages.chat.riskBanner}</Text>
        </Box>
      ) : null}
      {error.length > 0 ? (
        <Box paddingX={1}>
          <Text color={uiColor('danger')}>{error}</Text>
        </Box>
      ) : null}
      {notice.length > 0 ? (
        <Box paddingX={1}>
          <Text color={uiColor('warning')}>{notice}</Text>
        </Box>
      ) : null}
      {chatError.length > 0 ? (
        <Box paddingX={1}>
          <Text color={uiColor('danger')}>{chatError}</Text>
        </Box>
      ) : null}
      {streaming ? (
        <Box paddingX={1}>
          <Text color={uiColor('warning')}>{messages.chat.streaming}</Text>
        </Box>
      ) : null}

      {readOnly === true ? (
        <Box borderStyle="round" borderColor="gray" paddingX={1}>
          <Text dimColor>{messages.chat.readOnlyBar}</Text>
        </Box>
      ) : (
        <Box borderStyle="round" borderColor="gray" paddingX={1}>
          <MultilineInput
            value={input}
            onChange={setInput}
            onSubmit={(value) => {
              if (!streaming && canType) {
                void runStream('send', value);
              }
            }}
            placeholder={streaming ? messages.chat.placeholderStreaming : messages.chat.placeholder}
            disabled={!canType || streaming}
            maxLines={4}
          />
        </Box>
      )}

      <Box paddingX={1} justifyContent="space-between">
        <Text dimColor>
          {readOnly === true ? messages.chat.footerReadOnly : messages.chat.footer}
        </Text>
        <Text dimColor>{formatElapsed(elapsedMs)}</Text>
      </Box>
    </Box>
  );
}
