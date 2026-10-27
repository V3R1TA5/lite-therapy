import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig } from '../config/appConfig.js';
import { APP_NAME } from '../core/version.js';
import { messages } from '../i18n/zh-CN.js';
import type { AppService, AppSnapshot } from '../services/appService.js';
import { errorMessage } from './errorMessage.js';
import { ChatScreen } from './screens/ChatScreen.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { InternalRecordsScreen } from './screens/InternalRecordsScreen.js';
import { LockScreen } from './screens/LockScreen.js';
import { PostSessionScreen } from './screens/PostSessionScreen.js';
import { SessionListScreen } from './screens/SessionListScreen.js';
import { SetupWizard } from './screens/SetupWizard.js';
import { setUiTheme, uiColor } from './theme.js';

export interface AppProps {
  service: AppService;
}

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'setup'; resume: boolean; config: AppConfig | null }
  | { kind: 'locked'; notice?: string }
  | { kind: 'home'; config: AppConfig }
  | { kind: 'chat'; config: AppConfig; sessionId: string }
  | { kind: 'postSession'; config: AppConfig; sessionId: string }
  | { kind: 'records'; config: AppConfig; sessionId: string }
  | { kind: 'sessions'; config: AppConfig };

export function App(props: AppProps) {
  const { service } = props;
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [homeNotice, setHomeNotice] = useState('');
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if ('config' in view && view.config !== null) {
      setUiTheme(view.config.theme);
    } else {
      setUiTheme('dark');
    }
  }, [view]);

  const quit = useCallback(() => {
    void service.shutdownAndFlush().finally(() => {
      exit();
    });
  }, [service, exit]);

  const lock = useCallback(
    async (notice?: string) => {
      await service.lockAndFlush();
      setView(notice !== undefined ? { kind: 'locked', notice } : { kind: 'locked' });
    },
    [service],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await service.inspect();
        if (cancelled) {
          return;
        }
        if (snapshot.phase === 'setup') {
          setView({ kind: 'setup', resume: false, config: snapshot.config });
        } else if (snapshot.phase === 'locked') {
          if (service.hasAutoUnlock()) {
            try {
              const unlocked = await service.autoUnlock();
              if (cancelled) {
                return;
              }
              if (unlocked.onboardingComplete && unlocked.config) {
                setView({ kind: 'home', config: unlocked.config });
              } else {
                setView({ kind: 'setup', resume: true, config: unlocked.config });
              }
              return;
            } catch (autoError) {
              if (!cancelled) {
                setView({
                  kind: 'locked',
                  notice: messages.lock.autoUnlockFailed + ' ' + errorMessage(autoError),
                });
              }
              return;
            }
          }
          setView({ kind: 'locked' });
        } else if (snapshot.onboardingComplete && snapshot.config) {
          setView({ kind: 'home', config: snapshot.config });
        } else {
          setView({ kind: 'setup', resume: true, config: snapshot.config });
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          setView({ kind: 'error', message: errorMessage(bootstrapError) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service]);

  useEffect(() => {
    return () => {
      service.shutdown();
    };
  }, [service]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (view.kind === 'chat') {
        return;
      }
      quit();
      return;
    }
    if (key.ctrl && input === 'q') {
      if (view.kind === 'chat') {
        return;
      }
      quit();
      return;
    }
    if (key.ctrl && input === 'l' && (view.kind === 'home' || view.kind === 'sessions')) {
      void lock(messages.lock.manualNotice);
    }
  });

  const sessionViews = view.kind === 'home' || view.kind === 'chat' || view.kind === 'sessions';

  useInput(
    () => {
      lastActivity.current = Date.now();
    },
    { isActive: sessionViews },
  );

  const timeoutMinutes = sessionViews ? view.config.lock.timeoutMinutes : 0;

  useEffect(() => {
    if (timeoutMinutes <= 0) {
      return;
    }
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current >= timeoutMinutes * 60_000) {
        void lock(messages.lock.autoNotice);
      }
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [timeoutMinutes, lock]);

  const handleUnlocked = useCallback((snapshot: AppSnapshot) => {
    lastActivity.current = Date.now();
    setHomeNotice('');
    if (snapshot.onboardingComplete && snapshot.config) {
      setView({ kind: 'home', config: snapshot.config });
    } else {
      setView({ kind: 'setup', resume: true, config: snapshot.config });
    }
  }, []);

  const handleSetupComplete = useCallback((config: AppConfig) => {
    lastActivity.current = Date.now();
    setHomeNotice(messages.home.setupDone);
    setView({ kind: 'home', config });
  }, []);

  const handleConfigChange = useCallback((config: AppConfig) => {
    setView((current) => {
      if (current.kind === 'home') {
        return { kind: 'home', config };
      }
      if (current.kind === 'sessions') {
        return { kind: 'sessions', config };
      }
      return current;
    });
  }, []);

  const goHome = useCallback(
    (notice?: string) => {
      lastActivity.current = Date.now();
      setHomeNotice(notice ?? '');
      const config = service.getConfig();
      setView(config !== null ? { kind: 'home', config } : { kind: 'locked' });
    },
    [service],
  );

  if (columns < 80 || rows < 24) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={uiColor('warning')}>终端太小</Text>
        <Text>
          请调整到至少 80×24。当前：{columns}×{rows}
        </Text>
        <Text dimColor>Ctrl+C 退出</Text>
      </Box>
    );
  }

  if (view.kind === 'loading') {
    return (
      <Box flexDirection="column" padding={2}>
        <Text bold color={uiColor('accent')}>
          {APP_NAME}
        </Text>
        <Text dimColor>{messages.common.loading}</Text>
      </Box>
    );
  }

  if (view.kind === 'error') {
    return (
      <Box flexDirection="column" padding={2}>
        <Text bold color={uiColor('danger')}>
          {APP_NAME} {messages.common.error}
        </Text>
        <Text wrap="wrap">{view.message}</Text>
        <Box marginTop={1}>
          <Text dimColor>Ctrl+C 退出。若配置损坏，可先从备份恢复或改名后排错。</Text>
        </Box>
      </Box>
    );
  }

  if (view.kind === 'setup') {
    return (
      <SetupWizard
        key={view.resume ? 'setup-resume' : 'setup-fresh'}
        service={service}
        resume={view.resume}
        initialConfig={view.config}
        onComplete={handleSetupComplete}
        onQuit={quit}
      />
    );
  }

  if (view.kind === 'locked') {
    return <LockScreen service={service} notice={view.notice} onUnlocked={handleUnlocked} />;
  }

  if (view.kind === 'chat') {
    return (
      <ChatScreen
        service={service}
        sessionId={view.sessionId}
        onExit={goHome}
        onPostSession={(sessionId) => {
          setView({ kind: 'postSession', config: view.config, sessionId });
        }}
        onLock={lock}
        onQuit={quit}
      />
    );
  }

  if (view.kind === 'postSession') {
    return (
      <PostSessionScreen
        service={service}
        sessionId={view.sessionId}
        onBack={() => goHome()}
        onOpenRecords={() => {
          setView({ kind: 'records', config: view.config, sessionId: view.sessionId });
        }}
      />
    );
  }

  if (view.kind === 'records') {
    return (
      <InternalRecordsScreen
        service={service}
        sessionId={view.sessionId}
        onBack={() => {
          setView({ kind: 'postSession', config: view.config, sessionId: view.sessionId });
        }}
      />
    );
  }

  if (view.kind === 'sessions') {
    return (
      <SessionListScreen
        service={service}
        onOpenChat={(sessionId) => {
          setHomeNotice('');
          setView({ kind: 'chat', config: view.config, sessionId });
        }}
        onBack={() => {
          setHomeNotice('');
          setView({ kind: 'home', config: view.config });
        }}
      />
    );
  }

  return (
    <HomeScreen
      service={service}
      config={view.config}
      onConfigChange={handleConfigChange}
      onLock={lock}
      onQuit={quit}
      onOpenChat={(sessionId) => {
        setHomeNotice('');
        setView({ kind: 'chat', config: view.config, sessionId });
      }}
      onOpenSessions={() => {
        setHomeNotice('');
        setView({ kind: 'sessions', config: view.config });
      }}
      onOpenPostSession={(sessionId) => {
        setHomeNotice('');
        setView({ kind: 'postSession', config: view.config, sessionId });
      }}
      initialNotice={homeNotice}
    />
  );
}
