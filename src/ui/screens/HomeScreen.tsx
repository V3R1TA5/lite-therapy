import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import {
  type AppConfig,
  CONTEXT_BUDGET_PRESETS,
  type ContextBudgetPreset,
  LOCK_TIMEOUTS,
  type LockTimeout,
} from '../../config/appConfig.js';
import { APP_VERSION } from '../../core/version.js';
import type { MemoRecord } from '../../db/repositories/postSessionRepository.js';
import { messages } from '../../i18n/zh-CN.js';
import type { AppService, ManualBackupSummary } from '../../services/appService.js';
import {
  validateNewPassphrase,
  validatePassphraseConfirmation,
} from '../../services/setupPolicy.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { SingleLineInput } from '../components/SingleLineInput.js';
import { errorMessage } from '../errorMessage.js';
import { formatClock } from '../format.js';
import { uiColor } from '../theme.js';
import { DiagnosticsScreen } from './DiagnosticsScreen.js';
import { HelpScreen } from './HelpScreen.js';
import { LettersScreen } from './LettersScreen.js';
import { MemoriesScreen } from './MemoriesScreen.js';
import { ModelSetup, type ModelSetupResult } from './ModelSetup.js';

export interface HomeScreenProps {
  service: AppService;
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
  onLock: (notice?: string) => void;
  onQuit: () => void;
  onOpenChat: (sessionId: string) => void;
  onOpenSessions: () => void;
  onOpenPostSession: (sessionId: string) => void;
  initialNotice?: string;
}

type View =
  | 'menu'
  | 'settings'
  | 'lockTimeout'
  | 'contextBudget'
  | 'contextAudits'
  | 'changePass'
  | 'modelEdit'
  | 'modelInfo'
  | 'dataPaths'
  | 'diagnostics'
  | 'newSessionMemo'
  | 'letters'
  | 'memories'
  | 'memorySettings'
  | 'memoryEmbedding'
  | 'backupPassword'
  | 'backupResult'
  | 'backupList'
  | 'backupDetail'
  | 'commands'
  | 'restorePassword'
  | 'restoreConfirm'
  | 'wipeWarning'
  | 'wipePassword'
  | 'wipeConfirm'
  | 'help'
  | 'about';

type MenuAction =
  | 'continueCurrent'
  | 'resumeLast'
  | 'new'
  | 'organize'
  | 'sessions'
  | 'letters'
  | 'memories'
  | 'settings'
  | 'about'
  | 'lock'
  | 'quit';

type SettingsAction =
  | 'lockTimeout'
  | 'contextBudget'
  | 'contextAudits'
  | 'memorySettings'
  | 'theme'
  | 'backup'
  | 'backupList'
  | 'wipe'
  | 'help'
  | 'changePass'
  | 'modelEdit'
  | 'modelInfo'
  | 'dataPaths'
  | 'diagnostics'
  | 'about'
  | 'back';

function lockLabel(minutes: LockTimeout): string {
  return minutes === 0 ? messages.settings.lockOff : messages.settings.lockMinutes(minutes);
}

const CONTEXT_PRESET_IDS = Object.keys(CONTEXT_BUDGET_PRESETS) as ContextBudgetPreset[];

const CONTEXT_PRESET_LABELS: Record<ContextBudgetPreset, string> = {
  compact: messages.settings.contextPresetCompact,
  default: messages.settings.contextPresetDefault,
  long: messages.settings.contextPresetLong,
};

function contextWarningLabel(warning: string): string {
  return (messages.settings.contextWarnings as Record<string, string>)[warning] ?? warning;
}

function BackMenu(props: { id: string; onBack: () => void }) {
  return (
    <Box marginTop={1}>
      <SelectList
        key={props.id}
        options={[{ value: 'back', label: messages.common.back }]}
        onSelect={() => props.onBack()}
      />
    </Box>
  );
}

export function HomeScreen(props: HomeScreenProps) {
  const {
    service,
    config,
    onConfigChange,
    onLock,
    onQuit,
    onOpenChat,
    onOpenSessions,
    onOpenPostSession,
    initialNotice,
  } = props;
  const [view, setView] = useState<View>('menu');
  const [notice, setNotice] = useState(initialNotice ?? '');
  const [error, setError] = useState('');
  const [pendingMemo, setPendingMemo] = useState<MemoRecord | null>(null);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupPath, setBackupPath] = useState('');
  const [backupRunning, setBackupRunning] = useState(false);
  const [memoryEmbeddingInput, setMemoryEmbeddingInput] = useState('');
  const [backfilling, setBackfilling] = useState(false);
  const [backups, setBackups] = useState<ManualBackupSummary[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<ManualBackupSummary | null>(null);
  const [restoreText, setRestoreText] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreRunning, setRestoreRunning] = useState(false);
  const [wipePassword, setWipePassword] = useState('');
  const [wipePhrase, setWipePhrase] = useState('');
  const [wiping, setWiping] = useState(false);
  const [passStage, setPassStage] = useState<'old' | 'new' | 'confirm'>('old');
  const [oldPassphrase, setOldPassphrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [aboutBack, setAboutBack] = useState<'menu' | 'settings'>('menu');

  const profile = service.getActiveModelProfile();
  const displayName = config.profile.displayName;

  const beginNew = () => {
    try {
      const memo = service.getLatestReadyMemo();
      if (memo !== null || service.listMemoryCards().length > 0) {
        setPendingMemo(memo);
        setView('newSessionMemo');
      } else {
        const session = service.createSession();
        onOpenChat(session.id);
      }
    } catch (createError) {
      setError(errorMessage(createError));
    }
  };

  // 单行输入与模型设置自己处理 Esc；这里只负责选单类页面的返回。
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'k') {
        setView('commands');
        return;
      }
      if (!key.escape) {
        if (view === 'menu' && !key.ctrl && !key.meta) {
          if (input === 'n') {
            if (profile === null) {
              setError(messages.home.modelWarning);
            } else {
              beginNew();
            }
          } else if (input === 'm') {
            setView('memories');
          } else if (input === 'l') {
            setView('letters');
          } else if (input === 's') {
            setView('settings');
          } else if (input === '?') {
            setView('help');
          }
        }
        return;
      }
      if (view === 'commands') {
        setView('menu');
      } else if (view === 'help') {
        setView('menu');
      } else if (view === 'wipeWarning') {
        setView('settings');
      } else if (view === 'backupDetail') {
        setView('backupList');
      } else if (view === 'backupList') {
        setView('settings');
      } else if (view === 'settings') {
        setView('menu');
      } else if (
        view === 'lockTimeout' ||
        view === 'contextBudget' ||
        view === 'contextAudits' ||
        view === 'memorySettings' ||
        view === 'modelInfo' ||
        view === 'dataPaths' ||
        view === 'diagnostics'
      ) {
        setView('settings');
      } else if (view === 'about') {
        setView(aboutBack);
      } else if (view === 'newSessionMemo') {
        setPendingMemo(null);
        setView('menu');
      }
    },
    {
      isActive:
        view !== 'changePass' && view !== 'modelEdit' && view !== 'letters' && view !== 'memories',
    },
  );

  const go = (next: View) => {
    setError('');
    setNotice('');
    setView(next);
  };

  const updateTimeout = async (value: string) => {
    const minutes = LOCK_TIMEOUTS.find((candidate) => String(candidate) === value);
    if (minutes === undefined) {
      return;
    }
    try {
      const next = await service.updateLockTimeout(minutes);
      onConfigChange(next);
      setNotice(messages.settings.lockUpdated(minutes));
      setView('settings');
    } catch (updateError) {
      setError(errorMessage(updateError));
    }
  };

  const startNewSession = (mode: 'carry' | 'fresh' | 'disable') => {
    try {
      const session = service.createSession({
        ...(mode === 'carry' && pendingMemo !== null ? { memoId: pendingMemo.id } : {}),
        ...(mode === 'disable' ? { disableMemory: true } : {}),
      });
      setPendingMemo(null);
      onOpenChat(session.id);
    } catch (createError) {
      setError(errorMessage(createError));
    }
  };

  const updateContext = async (preset: ContextBudgetPreset) => {
    const budget = CONTEXT_BUDGET_PRESETS[preset];
    try {
      const next = await service.updateContextBudget({ ...budget });
      onConfigChange(next);
      setNotice(
        messages.settings.contextBudgetUpdated(
          next.context.historyTokens,
          next.context.summaryTriggerTokens,
          next.context.recentTargetTokens,
        ),
      );
      setView('settings');
    } catch (updateError) {
      setError(errorMessage(updateError));
    }
  };

  const submitBackup = async (submitted?: string) => {
    const password = submitted ?? backupPassword;
    if (password.length === 0) {
      setError('请输入启动密码。');
      return;
    }
    setBackupRunning(true);
    setError('');
    try {
      const path = await service.createBackup(password);
      setBackupPath(path);
      setBackupPassword('');
      setView('backupResult');
    } catch (backupError) {
      setError(errorMessage(backupError));
    } finally {
      setBackupRunning(false);
    }
  };

  const submitRestore = async () => {
    if (selectedBackup === null || restorePassword.length === 0) {
      setError('请先选择备份并输入密码。');
      return;
    }
    setRestoreRunning(true);
    setError('');
    try {
      await service.restoreBackup(selectedBackup.path, restorePassword);
      setRestorePassword('');
      onLock(messages.settings.restoreDone);
    } catch (restoreError) {
      setError(errorMessage(restoreError));
    } finally {
      setRestoreRunning(false);
    }
  };

  const submitWipe = async (phraseValue: string = wipePhrase) => {
    if (phraseValue !== messages.settings.wipePhrase) {
      setError('确认短语不正确。请输入“彻底删除”。');
      return;
    }
    if (wipePassword.length === 0) {
      setError('缺少启动密码，请返回重试。');
      return;
    }
    setWiping(true);
    setError('');
    try {
      await service.wipeAllData(wipePassword);
      onQuit();
    } catch (wipeError) {
      setError(errorMessage(wipeError));
    } finally {
      setWiping(false);
    }
  };

  const saveModel = async (result: ModelSetupResult) => {
    if (!result.profile) {
      setView('settings');
      return;
    }
    try {
      const id = result.profile.id;
      const next = await service.updateModelConfig([result.profile], { [id]: result.apiKey ?? '' });
      onConfigChange(next);
      setNotice(messages.model.saved);
      setView('settings');
    } catch (saveError) {
      setError(errorMessage(saveError));
      setView('settings');
    }
  };

  const resetPassphraseForm = () => {
    setPassStage('old');
    setOldPassphrase('');
    setNewPassphrase('');
    setConfirmation('');
    setError('');
  };

  if (view === 'lockTimeout') {
    const options = LOCK_TIMEOUTS.map((minutes) => ({
      value: String(minutes),
      label: lockLabel(minutes),
    }));
    return (
      <ScreenFrame title={messages.settings.lockTimeout} footer="↑↓ 选择 · Enter 保存 · Esc 返回">
        <Text>{messages.settings.lockTimeout}</Text>
        <Box marginTop={1} flexDirection="column">
          <SelectList
            key="home-lock-timeout"
            options={options}
            initialIndex={Math.max(0, LOCK_TIMEOUTS.indexOf(config.lock.timeoutMinutes))}
            onSelect={(value) => {
              void updateTimeout(value);
            }}
          />
        </Box>
        {error.length > 0 ? (
          <Box marginTop={1}>
            <Text color={uiColor('danger')}>{error}</Text>
          </Box>
        ) : null}
      </ScreenFrame>
    );
  }

  if (view === 'changePass') {
    const title =
      passStage === 'old'
        ? messages.settings.oldPassphrase
        : passStage === 'new'
          ? messages.settings.newPassphrase
          : messages.settings.confirmPassphrase;
    const placeholder = title;
    const value =
      passStage === 'old' ? oldPassphrase : passStage === 'new' ? newPassphrase : confirmation;
    const setValue =
      passStage === 'old'
        ? setOldPassphrase
        : passStage === 'new'
          ? setNewPassphrase
          : setConfirmation;

    const submit = async (submitted?: string) => {
      if (passStage === 'old') {
        const current = submitted ?? oldPassphrase;
        if (current.length === 0) {
          setError('请输入当前启动密码。');
          return;
        }
        setOldPassphrase(current);
        setError('');
        setPassStage('new');
        return;
      }
      if (passStage === 'new') {
        const next = submitted ?? newPassphrase;
        const issue = validateNewPassphrase(next);
        if (issue !== null) {
          setError(issue);
          return;
        }
        setNewPassphrase(next);
        setError('');
        setPassStage('confirm');
        return;
      }
      const currentConfirmation = submitted ?? confirmation;
      const issue = validatePassphraseConfirmation(newPassphrase, currentConfirmation);
      if (issue !== null) {
        setError(issue);
        return;
      }
      setConfirmation(currentConfirmation);
      try {
        await service.changePassphrase(oldPassphrase, newPassphrase);
        resetPassphraseForm();
        setNotice(messages.settings.passphraseChanged);
        setView('settings');
      } catch (changeError) {
        setError(errorMessage(changeError));
      }
    };

    return (
      <ScreenFrame
        title={messages.settings.changePassphrase}
        subtitle={title}
        footer={'Enter 继续 · Esc 返回 · 恢复短语保持不变'}
      >
        <Text dimColor>修改后恢复短语继续有效，旧启动密码立即失效。</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={value}
            onChange={setValue}
            onSubmit={(submitted) => {
              void submit(submitted);
            }}
            onEscape={() => {
              resetPassphraseForm();
              setView('settings');
            }}
            placeholder={placeholder}
            mask
          />
        </Box>
        {error.length > 0 ? (
          <Box marginTop={1}>
            <Text color={uiColor('danger')}>{error}</Text>
          </Box>
        ) : null}
      </ScreenFrame>
    );
  }

  if (view === 'modelEdit') {
    return (
      <ModelSetup
        service={service}
        initialProfile={profile ?? undefined}
        initialApiKey={profile ? service.getApiKey(profile.id) : undefined}
        allowSkip={false}
        onCancel={() => go('settings')}
        onDone={(result) => {
          void saveModel(result);
        }}
      />
    );
  }

  if (view === 'modelInfo') {
    return (
      <ScreenFrame title={messages.settings.modelDetails} footer="Esc 返回">
        {profile ? (
          <Box flexDirection="column">
            <Text bold>{profile.label}</Text>
            <Text dimColor>{profile.kind}</Text>
            <Text>{profile.baseUrl}</Text>
            <Text>{profile.model}</Text>
            <Text>
              {service.getApiKey(profile.id) ? messages.model.encryptedKey : messages.model.noKey}
            </Text>
          </Box>
        ) : (
          <Text color={uiColor('warning')}>{messages.model.skipWarning}</Text>
        )}
        <Box marginTop={1} flexDirection="column">
          <Text bold>{messages.settings.sendsTitle}</Text>
          <Text wrap="wrap">{messages.settings.sendsBody}</Text>
        </Box>
        <BackMenu id="home-model-info-back" onBack={() => go('settings')} />
      </ScreenFrame>
    );
  }

  if (view === 'dataPaths') {
    return (
      <ScreenFrame title={messages.settings.dataPaths} footer="Esc 返回">
        <Text bold>{messages.settings.storageTitle}</Text>
        <Text wrap="wrap">{messages.settings.storageBody}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>数据 {service.appPaths.data}</Text>
          <Text>配置 {service.appPaths.config}</Text>
          <Text>日志 {service.appPaths.log}</Text>
        </Box>
        <BackMenu id="home-data-paths-back" onBack={() => go('settings')} />
      </ScreenFrame>
    );
  }

  if (view === 'diagnostics') {
    return <DiagnosticsScreen service={service} onBack={() => go('settings')} />;
  }

  if (view === 'about') {
    return (
      <ScreenFrame title={messages.about.title} footer="Esc 返回">
        <Text bold>{messages.about.intro}</Text>
        <Box marginTop={1} flexDirection="column">
          {messages.about.points.map((point) => (
            <Text key={point} wrap="wrap">
              · {point}
            </Text>
          ))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            {messages.about.version} {APP_VERSION}
          </Text>
          <Text dimColor>{messages.about.license}</Text>
        </Box>
        <BackMenu id="home-about-back" onBack={() => setView(aboutBack)} />
      </ScreenFrame>
    );
  }

  if (view === 'letters') {
    return <LettersScreen service={service} onBack={() => go('menu')} />;
  }

  if (view === 'memories') {
    return <MemoriesScreen service={service} onBack={() => go('menu')} />;
  }

  if (view === 'backupList') {
    return (
      <ScreenFrame
        title={messages.settings.backupListTitle}
        footer="↑↓ 选择 · Enter 查看恢复说明 · Esc 返回设置"
      >
        <Text wrap="wrap" dimColor>
          {messages.settings.backupListHint}
        </Text>
        {backups.length === 0 ? (
          <Text wrap="wrap">{messages.settings.backupListEmpty}</Text>
        ) : (
          <Box marginTop={1}>
            <SelectList
              key="home-backup-list"
              options={backups.map((backup) => ({
                value: backup.path,
                label: backup.name,
                hint: backup.createdAt.slice(0, 19).replace('T', ' '),
              }))}
              onSelect={(path) => {
                try {
                  const selected = backups.find((backup) => backup.path === path) ?? null;
                  setSelectedBackup(selected);
                  setRestoreText(service.readBackupRestore(path));
                  setView('backupDetail');
                } catch (backupError) {
                  setError(errorMessage(backupError));
                }
              }}
            />
          </Box>
        )}
        {error.length > 0 ? <Text color={uiColor('danger')}>{error}</Text> : null}
        {backups.length === 0 ? (
          <BackMenu id="home-backup-list-back" onBack={() => go('settings')} />
        ) : null}
      </ScreenFrame>
    );
  }

  if (view === 'backupDetail' && selectedBackup !== null) {
    return (
      <ScreenFrame title={messages.settings.backupDetailTitle} footer="Esc 返回备份列表">
        <Text dimColor>{selectedBackup.path}</Text>
        <Box marginTop={1}>
          <Text wrap="wrap">{restoreText}</Text>
        </Box>
        <Box marginTop={1}>
          <SelectList
            key="home-backup-detail-actions"
            options={[
              { value: 'restore' as const, label: messages.settings.restoreAction },
              { value: 'back' as const, label: messages.settings.restoreBack },
            ]}
            onSelect={(value) => {
              if (value === 'restore') {
                setRestorePassword('');
                setError('');
                setView('restorePassword');
              } else {
                setView('backupList');
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (view === 'wipeWarning') {
    return (
      <ScreenFrame title={messages.settings.wipeWarningTitle} footer="↑↓ 选择 · Enter 确认">
        <Text wrap="wrap" color={uiColor('danger')}>
          {messages.settings.wipeWarningBody}
        </Text>
        <Box marginTop={1}>
          <SelectList
            key="home-wipe-warning"
            options={[
              { value: 'continue' as const, label: messages.settings.wipeContinue },
              { value: 'cancel' as const, label: messages.settings.wipeCancel },
            ]}
            onSelect={(value) => {
              if (value === 'continue') {
                setWipePassword('');
                setWipePhrase('');
                setError('');
                setView('wipePassword');
              } else {
                go('settings');
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (view === 'wipePassword') {
    return (
      <ScreenFrame title={messages.settings.wipePasswordTitle} footer="Enter 继续 · Esc 返回">
        <Text wrap="wrap">{messages.settings.wipePasswordHint}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={wipePassword}
            onChange={setWipePassword}
            onSubmit={(value) => {
              if (value.length === 0) {
                setError('请输入启动密码。');
                return;
              }
              setWipePassword(value);
              setError('');
              setView('wipeConfirm');
            }}
            onEscape={() => setView('wipeWarning')}
            placeholder={messages.settings.backupPlaceholder}
            mask
            disabled={wiping}
          />
        </Box>
        {error.length > 0 ? <Text color={uiColor('danger')}>{error}</Text> : null}
      </ScreenFrame>
    );
  }

  if (view === 'wipeConfirm') {
    return (
      <ScreenFrame title={messages.settings.wipeConfirmTitle} footer="Enter 删除 · Esc 取消">
        <Text wrap="wrap" color={uiColor('warning')}>
          {messages.settings.wipeConfirmBody}
        </Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={wipePhrase}
            onChange={setWipePhrase}
            onSubmit={(value) => {
              setWipePhrase(value);
              void submitWipe(value);
            }}
            onEscape={() => setView('wipeWarning')}
            placeholder={messages.settings.wipePlaceholder}
            disabled={wiping}
          />
        </Box>
        {wiping ? <Text color={uiColor('warning')}>正在删除…</Text> : null}
        {error.length > 0 ? <Text color={uiColor('danger')}>{error}</Text> : null}
      </ScreenFrame>
    );
  }

  if (view === 'restorePassword' && selectedBackup !== null) {
    return (
      <ScreenFrame title={messages.settings.restorePasswordTitle} footer="Enter 继续 · Esc 返回">
        <Text dimColor>{selectedBackup.path}</Text>
        <Text wrap="wrap">{messages.settings.restorePasswordHint}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={restorePassword}
            onChange={setRestorePassword}
            onSubmit={(value) => {
              if (value.length === 0) {
                setError('请输入备份密码。');
                return;
              }
              setRestorePassword(value);
              setError('');
              setView('restoreConfirm');
            }}
            onEscape={() => setView('backupDetail')}
            placeholder={messages.settings.backupPlaceholder}
            mask
            disabled={restoreRunning}
          />
        </Box>
        {error.length > 0 ? <Text color={uiColor('danger')}>{error}</Text> : null}
      </ScreenFrame>
    );
  }

  if (view === 'restoreConfirm' && selectedBackup !== null) {
    return (
      <ScreenFrame title={messages.settings.restoreConfirmTitle} footer="↑↓ 选择 · Enter 确认">
        <Text wrap="wrap" color={uiColor('warning')}>
          {messages.settings.restoreConfirmBody}
        </Text>
        <Box marginTop={1}>
          <SelectList
            key="home-restore-confirm"
            options={[
              { value: 'restore' as const, label: messages.settings.restoreConfirm },
              { value: 'cancel' as const, label: messages.settings.restoreCancel },
            ]}
            onSelect={(value) => {
              if (value === 'restore') {
                void submitRestore();
              } else {
                setView('backupDetail');
              }
            }}
          />
        </Box>
        {restoreRunning ? <Text color={uiColor('warning')}>正在恢复…</Text> : null}
        {error.length > 0 ? <Text color={uiColor('danger')}>{error}</Text> : null}
      </ScreenFrame>
    );
  }

  if (view === 'backupPassword') {
    return (
      <ScreenFrame title={messages.settings.backupTitle} footer="Enter 备份 · Esc 返回">
        <Text wrap="wrap">{messages.settings.backupHint}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={backupPassword}
            onChange={setBackupPassword}
            onSubmit={(value) => {
              void submitBackup(value);
            }}
            onEscape={() => go('settings')}
            placeholder={messages.settings.backupPlaceholder}
            mask
            disabled={backupRunning}
          />
        </Box>
        {backupRunning ? <Text color={uiColor('warning')}>正在备份…</Text> : null}
        {error.length > 0 ? <Text color={uiColor('danger')}>{error}</Text> : null}
      </ScreenFrame>
    );
  }

  if (view === 'backupResult') {
    return (
      <ScreenFrame title={messages.settings.backupData} footer="Enter 返回">
        <Text color={uiColor('success')}>{messages.settings.backupSuccess}</Text>
        <Box marginTop={1}>
          <Text wrap="wrap">{backupPath}</Text>
        </Box>
        <BackMenu id="home-backup-result-back" onBack={() => go('settings')} />
      </ScreenFrame>
    );
  }

  if (view === 'memoryEmbedding') {
    return (
      <ScreenFrame title={messages.settings.memoryEmbedding} footer="Enter 保存 · Esc 返回">
        <Text wrap="wrap" dimColor>
          {messages.settings.memoryEmbeddingHint}
        </Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={memoryEmbeddingInput}
            onChange={setMemoryEmbeddingInput}
            onSubmit={(value) => {
              void service
                .updateMemorySettings({ ...config.memory, embeddingModel: value.trim() })
                .then((updated) => {
                  onConfigChange(updated);
                  setNotice(messages.settings.memoryEmbeddingSaved);
                  setView('memorySettings');
                })
                .catch((saveError: unknown) => {
                  setError(errorMessage(saveError));
                });
            }}
            onEscape={() => setView('memorySettings')}
            placeholder="例如 text-embedding-3-small"
          />
        </Box>
        {notice.length > 0 ? <Text color={uiColor('success')}>{notice}</Text> : null}
        {error.length > 0 ? <Text color={uiColor('danger')}>{error}</Text> : null}
      </ScreenFrame>
    );
  }

  if (view === 'memorySettings') {
    return (
      <ScreenFrame
        title={messages.settings.memorySettingsTitle}
        footer="↑↓ 选择 · Enter 切换 · Esc 返回"
      >
        <Text wrap="wrap">{messages.settings.memoryHint}</Text>
        <Box marginTop={1}>
          <SelectList
            key="home-memory-settings"
            options={[
              {
                value: 'enabled' as const,
                label:
                  messages.settings.memoryEnabled +
                  '：' +
                  (config.memory.enabled
                    ? messages.settings.memoryOn
                    : messages.settings.memoryOff),
              },
              {
                value: 'sensitive' as const,
                label:
                  messages.settings.memorySensitive +
                  '：' +
                  (config.memory.includeSensitive
                    ? messages.settings.memoryOn
                    : messages.settings.memoryOff),
              },
              {
                value: 'embedding' as const,
                label:
                  messages.settings.memoryEmbedding +
                  '：' +
                  (config.memory.embeddingModel.length > 0
                    ? config.memory.embeddingModel
                    : messages.settings.memoryEmbeddingOff),
              },
              { value: 'backfill' as const, label: messages.settings.memoryBackfill },
              { value: 'back' as const, label: messages.common.back },
            ]}
            onSelect={(value) => {
              if (value === 'back') {
                go('settings');
                return;
              }
              if (value === 'backfill') {
                setBackfilling(true);
                setError('');
                void service
                  .backfillMemoryEmbeddings()
                  .then((count) => {
                    setNotice(
                      count > 0
                        ? messages.settings.memoryBackfillDone(count)
                        : messages.settings.memoryBackfillNone,
                    );
                  })
                  .catch((backfillError: unknown) => {
                    setError(errorMessage(backfillError));
                  })
                  .finally(() => {
                    setBackfilling(false);
                  });
                return;
              }
              if (value === 'embedding') {
                setMemoryEmbeddingInput(config.memory.embeddingModel);
                go('memoryEmbedding');
                return;
              }
              const next = {
                enabled: value === 'enabled' ? !config.memory.enabled : config.memory.enabled,
                includeSensitive:
                  value === 'sensitive'
                    ? !config.memory.includeSensitive
                    : config.memory.includeSensitive,
                embeddingModel: config.memory.embeddingModel,
              };
              void service
                .updateMemorySettings(next)
                .then((updated) => {
                  onConfigChange(updated);
                  setNotice(messages.settings.memoryUpdated);
                })
                .catch((updateError: unknown) => {
                  setError(errorMessage(updateError));
                });
            }}
          />
        </Box>
        {backfilling ? <Text color={uiColor('warning')}>正在回填向量…</Text> : null}
        {notice.length > 0 ? <Text color={uiColor('success')}>{notice}</Text> : null}
        {error.length > 0 ? <Text color={uiColor('danger')}>{error}</Text> : null}
      </ScreenFrame>
    );
  }

  if (view === 'newSessionMemo') {
    const memo = pendingMemo;
    return (
      <ScreenFrame
        title={
          memo !== null ? messages.home.newSessionMemoTitle : messages.home.newSessionOptionsTitle
        }
        footer="↑↓ 选择 · Enter 确认 · Esc 取消"
      >
        <Text wrap="wrap">
          {memo !== null ? messages.home.newSessionMemoBody : messages.home.newSessionMemoryBody}
        </Text>
        {memo !== null ? (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>主题：</Text>
            <Text wrap="wrap">{memo.content}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <SelectList
            key="home-new-session-memo"
            options={[
              {
                value: memo !== null ? ('carry' as const) : ('fresh' as const),
                label:
                  memo !== null ? messages.home.newSessionMemoYes : messages.home.newSessionStart,
              },
              { value: 'no' as const, label: messages.home.newSessionMemoNo },
              { value: 'cancel' as const, label: messages.home.newSessionMemoCancel },
            ]}
            onSelect={(value) => {
              if (value === 'carry') {
                startNewSession('carry');
              } else if (value === 'fresh') {
                startNewSession('fresh');
              } else if (value === 'no') {
                startNewSession('disable');
              } else {
                setPendingMemo(null);
                setView('menu');
              }
            }}
          />
        </Box>
        {error.length > 0 ? (
          <Box marginTop={1}>
            <Text color={uiColor('danger')}>{error}</Text>
          </Box>
        ) : null}
      </ScreenFrame>
    );
  }

  if (view === 'contextBudget') {
    const currentIndex = CONTEXT_PRESET_IDS.findIndex((id) => {
      const preset = CONTEXT_BUDGET_PRESETS[id];
      return (
        preset.historyTokens === config.context.historyTokens &&
        preset.summaryTriggerTokens === config.context.summaryTriggerTokens &&
        preset.recentTargetTokens === config.context.recentTargetTokens
      );
    });
    return (
      <ScreenFrame
        title={messages.settings.contextBudgetTitle}
        footer="↑↓ 选择 · Enter 保存 · Esc 返回"
      >
        <Text wrap="wrap">{messages.settings.contextBudgetHint}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            {messages.settings.contextBudgetCurrent(
              config.context.historyTokens,
              config.context.summaryTriggerTokens,
              config.context.recentTargetTokens,
            )}
          </Text>
        </Box>
        <Box marginTop={1}>
          <SelectList
            key="home-context-budget"
            options={CONTEXT_PRESET_IDS.map((id) => ({
              value: id,
              label: CONTEXT_PRESET_LABELS[id],
            }))}
            initialIndex={Math.max(0, currentIndex)}
            onSelect={(value: ContextBudgetPreset) => {
              void updateContext(value);
            }}
          />
        </Box>
        {error.length > 0 ? (
          <Box marginTop={1}>
            <Text color={uiColor('danger')}>{error}</Text>
          </Box>
        ) : null}
      </ScreenFrame>
    );
  }

  if (view === 'contextAudits') {
    const session = service.getOpenSession() ?? service.getLastEndedSession();
    if (session === null) {
      return (
        <ScreenFrame title={messages.settings.contextAudits} footer="Esc 返回">
          <Text wrap="wrap">{messages.settings.contextAuditsNoSession}</Text>
          <BackMenu id="home-context-audits-empty-back" onBack={() => go('settings')} />
        </ScreenFrame>
      );
    }
    const audits = service.listContextAudits(session.id, 10).slice(-6).reverse();
    return (
      <ScreenFrame title={messages.settings.contextAudits} footer="Esc 返回 · 不显示正文">
        <Text bold>{session.title}</Text>
        <Text wrap="wrap" dimColor>
          {messages.settings.contextAuditsHint}
        </Text>
        {audits.length === 0 ? (
          <Box marginTop={1}>
            <Text wrap="wrap">{messages.settings.contextAuditsEmpty}</Text>
          </Box>
        ) : (
          <Box marginTop={1} flexDirection="column">
            {audits.map((audit) => {
              const included = audit.entries.filter((entry) => entry.included).length;
              return (
                <Box key={audit.id} flexDirection="column" marginBottom={1}>
                  <Text bold>{formatClock(audit.createdAt, config.profile.timezone)}</Text>
                  <Text wrap="wrap">
                    {messages.settings.contextAuditLine(
                      audit.promptTokens,
                      audit.historyTokens,
                      audit.historyMessages,
                      audit.truncated,
                      audit.summaryUsed,
                    )}
                  </Text>
                  <Text wrap="wrap" dimColor>
                    {messages.settings.contextAuditEntries(audit.entries.length, included)}
                  </Text>
                  <Text wrap="wrap" dimColor>
                    {messages.settings.contextAuditWarnings}
                    {audit.warnings.length > 0
                      ? audit.warnings.map(contextWarningLabel).join('、')
                      : messages.settings.contextAuditNone}
                  </Text>
                </Box>
              );
            })}
          </Box>
        )}
        <BackMenu id="home-context-audits-back" onBack={() => go('settings')} />
      </ScreenFrame>
    );
  }

  if (view === 'settings') {
    const settingsOptions = [
      {
        value: 'lockTimeout' as const,
        label: messages.settings.lockTimeout + '：' + lockLabel(config.lock.timeoutMinutes),
      },
      {
        value: 'contextBudget' as const,
        label: messages.settings.contextBudgetMenu(
          config.context.historyTokens,
          config.context.summaryTriggerTokens,
        ),
      },
      { value: 'contextAudits' as const, label: messages.settings.contextAudits },
      { value: 'memorySettings' as const, label: messages.settings.memorySettings },
      {
        value: 'theme' as const,
        label:
          config.theme === 'light' ? messages.settings.themeLight : messages.settings.themeDark,
      },
      { value: 'backup' as const, label: messages.settings.backupData },
      { value: 'backupList' as const, label: messages.settings.backupList },
      { value: 'wipe' as const, label: messages.settings.wipeData },
      { value: 'changePass' as const, label: messages.settings.changePassphrase },
      { value: 'modelEdit' as const, label: messages.settings.reconfigureModel },
      { value: 'modelInfo' as const, label: messages.settings.modelDetails },
      { value: 'dataPaths' as const, label: messages.settings.dataPaths },
      { value: 'diagnostics' as const, label: messages.settings.diagnostics },
      { value: 'help' as const, label: messages.help.title },
      { value: 'about' as const, label: messages.settings.about },
      { value: 'back' as const, label: messages.settings.back },
    ];
    return (
      <ScreenFrame title={messages.settings.title} footer="↑↓ 选择 · Enter 打开 · Esc 返回">
        {notice.length > 0 ? (
          <Box marginBottom={1}>
            <Text color={uiColor('success')}>{notice}</Text>
          </Box>
        ) : null}
        {error.length > 0 ? (
          <Box marginBottom={1}>
            <Text color={uiColor('danger')}>{error}</Text>
          </Box>
        ) : null}
        <SelectList
          key="home-settings"
          options={settingsOptions}
          onSelect={(value: SettingsAction) => {
            if (value === 'lockTimeout') {
              go('lockTimeout');
            } else if (value === 'contextBudget') {
              go('contextBudget');
            } else if (value === 'contextAudits') {
              go('contextAudits');
            } else if (value === 'memorySettings') {
              go('memorySettings');
            } else if (value === 'theme') {
              const next = config.theme === 'light' ? 'dark' : 'light';
              void service
                .updateTheme(next)
                .then((updated) => {
                  onConfigChange(updated);
                  setNotice(messages.settings.themeUpdated);
                })
                .catch((themeError: unknown) => {
                  setError(errorMessage(themeError));
                });
            } else if (value === 'backup') {
              setBackupPassword('');
              go('backupPassword');
            } else if (value === 'backupList') {
              setBackups(service.listManualBackups());
              go('backupList');
            } else if (value === 'wipe') {
              setWipePassword('');
              setWipePhrase('');
              go('wipeWarning');
            } else if (value === 'changePass') {
              resetPassphraseForm();
              setView('changePass');
            } else if (value === 'modelEdit') {
              go('modelEdit');
            } else if (value === 'modelInfo') {
              go('modelInfo');
            } else if (value === 'dataPaths') {
              go('dataPaths');
            } else if (value === 'diagnostics') {
              go('diagnostics');
            } else if (value === 'help') {
              go('help');
            } else if (value === 'about') {
              setAboutBack('settings');
              go('about');
            } else {
              setView('menu');
            }
          }}
        />
      </ScreenFrame>
    );
  }

  if (view === 'help') {
    return <HelpScreen onBack={() => go('menu')} />;
  }

  if (view === 'commands') {
    return (
      <ScreenFrame title={messages.home.commandTitle} footer={messages.home.commandFooter}>
        <Text dimColor wrap="wrap">
          {messages.home.commandHint}
        </Text>
        <Box marginTop={1}>
          <SelectList
            key="home-command-palette"
            options={[
              {
                value: 'new' as const,
                label: messages.home.commandNew,
                disabled: profile === null,
              },
              { value: 'sessions' as const, label: messages.home.commandSessions },
              { value: 'letters' as const, label: messages.home.commandLetters },
              { value: 'memories' as const, label: messages.home.commandMemories },
              { value: 'settings' as const, label: messages.home.commandSettings },
              { value: 'backup' as const, label: messages.home.commandBackup },
              { value: 'lock' as const, label: messages.home.commandLock },
              { value: 'quit' as const, label: messages.home.commandQuit },
              { value: 'back' as const, label: messages.home.commandBack },
            ]}
            onSelect={(value) => {
              if (value === 'new') {
                beginNew();
              } else if (value === 'sessions') {
                onOpenSessions();
              } else if (value === 'letters') {
                setView('letters');
              } else if (value === 'memories') {
                setView('memories');
              } else if (value === 'settings') {
                setView('settings');
              } else if (value === 'backup') {
                setBackups(service.listManualBackups());
                setView('backupList');
              } else if (value === 'lock') {
                onLock(messages.lock.manualNotice);
              } else if (value === 'quit') {
                onQuit();
              } else {
                setView('menu');
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  const openSession = service.getOpenSession();
  const lastEnded = service.getLastEndedSession();
  const hasSessions = service.listSessions(1).length > 0;
  const lastEndedJobs = lastEnded === null ? [] : service.listPostSessionJobs(lastEnded.id);
  const unreadLetters = service.countUnreadLetters();
  const hasLetters = unreadLetters > 0 || service.listLetters(1).length > 0;
  const memoryCards = service.listMemoryCards();
  const hasMemories = memoryCards.length > 0;
  const hasModel = profile !== null;
  const sessionMenuOptions = openSession
    ? [
        {
          value: 'continueCurrent' as const,
          label: messages.home.continueCurrent,
          disabled: !hasModel,
        },
      ]
    : [
        { value: 'new' as const, label: messages.home.newSession, disabled: !hasModel },
        ...(lastEnded !== null
          ? [
              {
                value: 'resumeLast' as const,
                label: messages.home.continueSession,
                disabled: !hasModel,
              },
            ]
          : []),
      ];
  const menuOptions = [
    ...sessionMenuOptions,
    ...(lastEnded !== null && lastEndedJobs.length > 0
      ? [
          {
            value: 'organize' as const,
            label: messages.home.organize,
            disabled: !hasModel,
          },
        ]
      : []),
    {
      value: 'sessions' as const,
      label: messages.home.sessionList,
      disabled: !hasSessions,
    },
    {
      value: 'letters' as const,
      label: unreadLetters > 0 ? messages.home.lettersUnread(unreadLetters) : messages.home.letters,
      disabled: !hasLetters,
    },
    {
      value: 'memories' as const,
      label:
        memoryCards.length > 0
          ? messages.home.memoriesCount(memoryCards.length)
          : messages.home.memories,
      disabled: !hasMemories,
    },
    { value: 'settings' as const, label: messages.home.settings },
    { value: 'about' as const, label: messages.home.about },
    { value: 'lock' as const, label: messages.home.lock },
    { value: 'quit' as const, label: messages.home.quit },
  ];

  return (
    <ScreenFrame
      title={messages.home.menuTitle}
      subtitle={displayName.length > 0 ? displayName : undefined}
      footer={messages.home.footer}
    >
      <Text bold>{messages.home.greeting(displayName)}</Text>
      <Box marginTop={1} flexDirection="column">
        {profile ? (
          <Text color={uiColor('success')}>{messages.home.modelReady(profile.model)}</Text>
        ) : (
          <Text color={uiColor('warning')}>{messages.home.modelWarning}</Text>
        )}
        <Text dimColor>{messages.home.lockTimeout(config.lock.timeoutMinutes)}</Text>
        {openSession !== null ? (
          <Text dimColor>{messages.home.currentSession(openSession.title)}</Text>
        ) : lastEnded !== null ? (
          <Text dimColor>{messages.home.lastSession(lastEnded.title)}</Text>
        ) : (
          <Text dimColor>{messages.home.noSessions}</Text>
        )}
      </Box>
      {notice.length > 0 ? (
        <Box marginTop={1}>
          <Text color={uiColor('success')}>{notice}</Text>
        </Box>
      ) : null}
      {error.length > 0 ? (
        <Box marginTop={1}>
          <Text color={uiColor('danger')}>{error}</Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <SelectList
          key="home-menu"
          options={menuOptions}
          onSelect={(value: MenuAction) => {
            if (value === 'settings') {
              go('settings');
            } else if (value === 'about') {
              setAboutBack('menu');
              go('about');
            } else if (value === 'lock') {
              onLock(messages.lock.manualNotice);
            } else if (value === 'quit') {
              onQuit();
            } else if (value === 'sessions') {
              onOpenSessions();
            } else if (value === 'letters') {
              go('letters');
            } else if (value === 'organize' && lastEnded !== null) {
              onOpenPostSession(lastEnded.id);
            } else if (value === 'memories') {
              go('memories');
            } else if (value === 'continueCurrent' && openSession !== null) {
              onOpenChat(openSession.id);
            } else if (value === 'new') {
              beginNew();
            } else if (value === 'resumeLast') {
              try {
                const session = service.continueLastSession();
                onOpenChat(session.id);
              } catch (continueError) {
                setError(errorMessage(continueError));
              }
            }
          }}
        />
      </Box>
    </ScreenFrame>
  );
}
