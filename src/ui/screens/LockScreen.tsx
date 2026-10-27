import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { AI_DISCLOSURE, APP_NAME } from '../../core/version.js';
import { messages } from '../../i18n/zh-CN.js';
import { type AppService, AppServiceError, type AppSnapshot } from '../../services/appService.js';
import {
  validateNewPassphrase,
  validatePassphraseConfirmation,
} from '../../services/setupPolicy.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SingleLineInput } from '../components/SingleLineInput.js';
import { errorMessage } from '../errorMessage.js';
import { uiColor } from '../theme.js';

export interface LockScreenProps {
  service: AppService;
  notice?: string;
  onUnlocked: (snapshot: AppSnapshot) => void;
}

type Mode = 'unlock' | 'recoveryPhrase' | 'recoveryPass' | 'recoveryConfirm';

export function LockScreen(props: LockScreenProps) {
  const { service, notice, onUnlocked } = props;
  const [mode, setMode] = useState<Mode>('unlock');
  const [passphrase, setPassphrase] = useState('');
  const [phrase, setPhrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [autoUnlocking, setAutoUnlocking] = useState(false);

  useEffect(() => {
    if (blockedUntil === 0) {
      setRemaining(0);
      return;
    }
    const update = () => {
      const seconds = Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) {
        setBlockedUntil(0);
      }
    };
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [blockedUntil]);

  useInput(
    (input, key) => {
      if (key.tab || input === '\t') {
        setMode('recoveryPhrase');
        setError('');
        return;
      }
      if (key.ctrl && input === 'a' && service.hasAutoUnlock()) {
        setAutoUnlocking(true);
        setError('');
        void service
          .autoUnlock()
          .then((snapshot) => {
            setAutoUnlocking(false);
            onUnlocked(snapshot);
          })
          .catch((unlockError: unknown) => {
            setAutoUnlocking(false);
            setError(errorMessage(unlockError));
          });
      }
    },
    { isActive: mode === 'unlock' && !busy && !autoUnlocking && remaining === 0 },
  );

  const unlock = async (submittedPassphrase: string = passphrase) => {
    if (busy || remaining > 0) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const snapshot = await service.unlock(submittedPassphrase);
      setPassphrase('');
      onUnlocked(snapshot);
    } catch (unlockError) {
      setPassphrase('');
      setError(errorMessage(unlockError));
      if (unlockError instanceof AppServiceError && unlockError.retryAfterMs) {
        setBlockedUntil(Date.now() + unlockError.retryAfterMs);
      }
    } finally {
      setBusy(false);
    }
  };

  const continueRecovery = () => {
    setBusy(true);
    setError('');
    void service
      .recoverWithPhrase(phrase, newPassphrase)
      .then((snapshot) => {
        setPhrase('');
        setNewPassphrase('');
        setConfirmation('');
        onUnlocked(snapshot);
      })
      .catch((recoverError: unknown) => {
        setError(errorMessage(recoverError));
        if (recoverError instanceof AppServiceError && recoverError.retryAfterMs) {
          setBlockedUntil(Date.now() + recoverError.retryAfterMs);
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const footer =
    mode === 'unlock'
      ? service.hasAutoUnlock()
        ? 'Ctrl+A 自动解锁 · Tab 用恢复短语 · Ctrl+C 退出'
        : 'Tab 用恢复短语 · Ctrl+C 退出'
      : 'Esc 返回 · Ctrl+C 退出';

  const back = () => {
    setError('');
    if (mode === 'recoveryPhrase') {
      setMode('unlock');
    } else if (mode === 'recoveryPass') {
      setMode('recoveryPhrase');
    } else {
      setMode('recoveryPass');
    }
  };

  if (mode === 'unlock') {
    return (
      <ScreenFrame title={messages.lock.title} subtitle={APP_NAME} footer={footer}>
        {notice ? <Text color={uiColor('warning')}>{notice}</Text> : null}
        <Box marginTop={notice ? 1 : 0}>
          <Text dimColor>{AI_DISCLOSURE}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>{messages.lock.prompt}</Text>
          {service.hasAutoUnlock() ? (
            <Text dimColor>本机自动解锁已开启，按 Ctrl+A 解锁；也可以输入密码。</Text>
          ) : null}
          <SingleLineInput
            value={passphrase}
            onChange={setPassphrase}
            onSubmit={(value) => {
              void unlock(value);
            }}
            placeholder={messages.lock.placeholder}
            mask
            disabled={busy || remaining > 0}
          />
        </Box>
        {busy ? (
          <Box marginTop={1}>
            <Text color={uiColor('warning')}>{messages.lock.unlocking}</Text>
          </Box>
        ) : null}
        {remaining > 0 ? (
          <Box marginTop={1}>
            <Text color={uiColor('warning')}>{messages.lock.throttled(remaining)}</Text>
          </Box>
        ) : null}
        {error.length > 0 && remaining === 0 ? (
          <Box marginTop={1}>
            <Text color={uiColor('danger')}>{error}</Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{messages.lock.recoveryHint}</Text>
          <Text dimColor>{messages.lock.forgot}</Text>
        </Box>
      </ScreenFrame>
    );
  }

  if (mode === 'recoveryPhrase') {
    return (
      <ScreenFrame title={messages.lock.recoveryTitle} footer={footer}>
        <Text dimColor>{messages.lock.recoveryPhrasePrompt}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={phrase}
            onChange={setPhrase}
            onSubmit={(value) => {
              if (value.trim().length === 0) {
                setError('请先输入恢复短语。');
                return;
              }
              setPhrase(value);
              setError('');
              setMode('recoveryPass');
            }}
            onEscape={back}
            placeholder={messages.lock.recoveryPhrasePlaceholder}
            mask
            disabled={busy}
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

  if (mode === 'recoveryPass') {
    return (
      <ScreenFrame title={messages.lock.newPassphraseTitle} footer={footer}>
        <Text dimColor>{messages.lock.newPassphraseHint}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={newPassphrase}
            onChange={setNewPassphrase}
            onSubmit={(value) => {
              const issue = validateNewPassphrase(value);
              if (issue !== null) {
                setError(issue);
                return;
              }
              setError('');
              setMode('recoveryConfirm');
            }}
            onEscape={back}
            placeholder={messages.lock.newPassphrasePlaceholder}
            mask
            disabled={busy}
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

  return (
    <ScreenFrame title={messages.lock.newPassphraseConfirm} footer={footer}>
      <Text dimColor>恢复短语正确后，将用它重新包裹数据库密钥。</Text>
      <Box marginTop={1}>
        <SingleLineInput
          value={confirmation}
          onChange={setConfirmation}
          onSubmit={(value) => {
            const issue = validatePassphraseConfirmation(newPassphrase, value);
            if (issue !== null) {
              setError(issue);
              return;
            }
            setConfirmation(value);
            continueRecovery();
          }}
          onEscape={back}
          placeholder={messages.lock.newPassphraseConfirm}
          mask
          disabled={busy}
        />
      </Box>
      {busy ? (
        <Box marginTop={1}>
          <Text color={uiColor('warning')}>{messages.lock.recovering}</Text>
        </Box>
      ) : null}
      {error.length > 0 ? (
        <Box marginTop={1}>
          <Text color={uiColor('danger')}>{error}</Text>
        </Box>
      ) : null}
    </ScreenFrame>
  );
}
