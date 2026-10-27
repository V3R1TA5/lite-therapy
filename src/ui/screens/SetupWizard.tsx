import { Box, Text } from 'ink';
import { useState } from 'react';
import {
  type AgeBand,
  type AppConfig,
  isValidTimezone,
  type ProfileSettings,
  systemTimezone,
} from '../../config/appConfig.js';
import { messages } from '../../i18n/zh-CN.js';
import { createRecoveryPhrase } from '../../security/vault.js';
import type { AppService } from '../../services/appService.js';
import {
  createRecoveryChallenge,
  normalizeAnswer,
  type RecoveryChallenge,
  validateNewPassphrase,
  validatePassphraseConfirmation,
} from '../../services/setupPolicy.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { SingleLineInput } from '../components/SingleLineInput.js';
import { errorMessage } from '../errorMessage.js';
import { uiColor } from '../theme.js';
import { ModelSetup, type ModelSetupResult } from './ModelSetup.js';

const FRESH_STEPS = [
  'consent',
  'passphrase',
  'passphraseConfirm',
  'recoveryShow',
  'recoveryCheck',
  'profileName',
  'profileAge',
  'profileTimezone',
  'model',
] as const;

type WizardStep = (typeof FRESH_STEPS)[number];

const RESUME_STEPS = [
  'profileName',
  'profileAge',
  'profileTimezone',
  'model',
] as const satisfies readonly WizardStep[];

export interface SetupWizardProps {
  service: AppService;
  resume: boolean;
  initialConfig?: AppConfig | null;
  onComplete: (config: AppConfig) => void;
  onQuit: () => void;
}

export function SetupWizard(props: SetupWizardProps) {
  const { service, resume, initialConfig, onComplete, onQuit } = props;
  const steps: readonly WizardStep[] = resume ? RESUME_STEPS : FRESH_STEPS;

  const [stepIndex, setStepIndex] = useState(0);
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [challenge, setChallenge] = useState<RecoveryChallenge | null>(null);
  const [answer, setAnswer] = useState('');
  const [recoveryIndex, setRecoveryIndex] = useState(0);
  const [profile, setProfile] = useState<ProfileSettings>(() => ({
    displayName: initialConfig?.profile.displayName ?? '',
    locale: 'zh-CN',
    timezone: initialConfig?.profile.timezone ?? systemTimezone(),
    ageBand: initialConfig?.profile.ageBand ?? 'unspecified',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'wizard' | 'finishing'>('wizard');
  const [vaultCreated, setVaultCreated] = useState(false);
  const [pendingModel, setPendingModel] = useState<ModelSetupResult | null>(null);
  const [finishError, setFinishError] = useState('');

  const step: WizardStep = steps[stepIndex] ?? 'model';
  const stepLabel = messages.common.step(stepIndex + 1, steps.length);
  // 保险库创建后不再允许退回密码/短语步骤：重填不会重新包裹密钥。
  const canGoBack = !busy && stepIndex > 0 && !(vaultCreated && step === 'profileName');
  const backHint = canGoBack ? ' · Esc 返回' : '';

  const goNext = () => {
    setError('');
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  };

  const goBack = () => {
    if (!canGoBack) {
      return;
    }
    setError('');
    if (step === 'recoveryCheck') {
      setRecoveryIndex(0);
      setAnswer('');
    }
    setStepIndex((current) => Math.max(0, current - 1));
  };

  const prepareRecovery = (submittedConfirmation: string = confirmation) => {
    setConfirmation(submittedConfirmation);
    const issue = validatePassphraseConfirmation(passphrase, submittedConfirmation);
    if (issue !== null) {
      setError(issue);
      return;
    }
    const phrase = createRecoveryPhrase();
    setRecoveryPhrase(phrase);
    setChallenge(createRecoveryChallenge(phrase));
    setError('');
    goNext();
  };

  const submitRecoveryWord = (value: string) => {
    if (challenge === null) {
      return;
    }
    const expected = challenge.words[recoveryIndex];
    if (expected === undefined) {
      return;
    }
    if (normalizeAnswer(value) !== expected) {
      const position = (challenge.indexes[recoveryIndex] ?? recoveryIndex) + 1;
      setError(messages.setup.recoveryWrong(position));
      setAnswer('');
      return;
    }
    if (recoveryIndex + 1 >= challenge.words.length) {
      setAnswer('');
      setRecoveryIndex(0);
      setBusy(true);
      setError('');
      void service
        .beginSetup(passphrase, recoveryPhrase)
        .then(() => {
          setPassphrase('');
          setConfirmation('');
          setVaultCreated(true);
          setBusy(false);
          goNext();
        })
        .catch((setupError: unknown) => {
          setBusy(false);
          setError(errorMessage(setupError));
        });
      return;
    }
    setRecoveryIndex((current) => current + 1);
    setAnswer('');
    setError('');
  };

  const saveOnboarding = async (result: ModelSetupResult) => {
    setBusy(true);
    setFinishError('');
    try {
      const models = result.profile ? [result.profile] : [];
      const apiKeys = result.profile && result.apiKey ? { [result.profile.id]: result.apiKey } : {};
      const config = await service.completeOnboarding({ profile, models, apiKeys });
      onComplete(config);
    } catch (saveError) {
      setFinishError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const finishWithModel = (result: ModelSetupResult) => {
    setPendingModel(result);
    setPhase('finishing');
    void saveOnboarding(result);
  };

  if (phase === 'finishing') {
    const retryOptions = [
      { value: 'retry' as const, label: messages.common.retry },
      { value: 'quit' as const, label: messages.common.quit },
    ];
    return (
      <ScreenFrame title={messages.setup.title} footer={messages.common.ctrlC}>
        {busy ? (
          <Text color={uiColor('warning')}>{messages.setup.finishing}</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={uiColor('danger')}>{messages.common.error}</Text>
            <Text>{finishError}</Text>
            <Text dimColor>设置数据已加密保存，可以重试，或退出后重新打开。</Text>
            <Box marginTop={1} flexDirection="column">
              <SelectList
                key="setup-finishing"
                options={retryOptions}
                onSelect={(value) => {
                  if (value === 'retry' && pendingModel) {
                    void saveOnboarding(pendingModel);
                  } else if (value === 'quit') {
                    onQuit();
                  }
                }}
              />
            </Box>
          </Box>
        )}
      </ScreenFrame>
    );
  }

  if (step === 'consent') {
    const options = [
      { value: 'agree' as const, label: messages.setup.consentAgree },
      { value: 'leave' as const, label: messages.setup.consentLeave },
    ];
    return (
      <ScreenFrame
        title={messages.setup.consentTitle}
        subtitle={stepLabel}
        footer="↑↓ 选择 · Enter 确认 · Ctrl+C 退出"
      >
        <Text>{messages.setup.welcome}</Text>
        <Box flexDirection="column" marginTop={1}>
          {messages.setup.consentPoints.map((point) => (
            <Text key={point} wrap="wrap">
              · {point}
            </Text>
          ))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <SelectList
            options={options}
            onSelect={(value) => {
              if (value === 'agree') {
                goNext();
              } else {
                onQuit();
              }
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (step === 'passphrase') {
    return (
      <ScreenFrame
        title={messages.setup.passphraseTitle}
        subtitle={stepLabel}
        footer={'Enter 继续' + backHint}
      >
        <Text dimColor>{messages.setup.passphraseHint}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={passphrase}
            onChange={setPassphrase}
            onSubmit={(value) => {
              const issue = validateNewPassphrase(value);
              if (issue !== null) {
                setError(issue);
                return;
              }
              setError('');
              goNext();
            }}
            placeholder={messages.setup.passphrasePlaceholder}
            onEscape={canGoBack ? goBack : undefined}
            disabled={busy}
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

  if (step === 'passphraseConfirm') {
    return (
      <ScreenFrame
        title={messages.setup.passphraseConfirmTitle}
        subtitle={stepLabel}
        footer={'Enter 继续' + backHint}
      >
        <Text dimColor>两次输入需要一致。密码只用于本机解锁。</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={confirmation}
            onChange={setConfirmation}
            onSubmit={(value) => prepareRecovery(value)}
            placeholder={messages.setup.passphraseConfirmPlaceholder}
            onEscape={canGoBack ? goBack : undefined}
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

  if (step === 'recoveryShow') {
    return (
      <ScreenFrame
        title={messages.setup.recoveryTitle}
        subtitle={stepLabel}
        footer={'↑↓ 选择 · Enter 确认' + backHint + ' · 离开后无法再次查看'}
      >
        <Text>{messages.setup.recoveryIntro}</Text>
        <Box
          marginY={1}
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          flexDirection="column"
        >
          <Text wrap="wrap">{recoveryPhrase}</Text>
        </Box>
        <Text color={uiColor('warning')}>{messages.setup.recoveryWarning}</Text>
        <Box marginTop={1}>
          <SelectList
            key="setup-recovery-show"
            options={[{ value: 'written', label: messages.setup.recoveryContinue }]}
            onEscape={canGoBack ? goBack : undefined}
            onSelect={() => {
              setRecoveryIndex(0);
              setAnswer('');
              setError('');
              goNext();
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (step === 'recoveryCheck') {
    const position = (challenge?.indexes[recoveryIndex] ?? recoveryIndex) + 1;
    return (
      <ScreenFrame
        title={messages.setup.recoveryCheckTitle}
        subtitle={stepLabel}
        footer={'第 ' + (recoveryIndex + 1) + ' / 3 个词 · Enter 确认' + backHint}
      >
        <Text dimColor>{messages.setup.recoveryCheckHint}</Text>
        <Box marginTop={1}>
          <Text bold>{messages.setup.recoveryWordPrompt(position)}</Text>
        </Box>
        <Box marginTop={1}>
          <SingleLineInput
            value={answer}
            onChange={setAnswer}
            onSubmit={submitRecoveryWord}
            onEscape={canGoBack ? goBack : undefined}
            placeholder="输入这个词"
            disabled={busy}
          />
        </Box>
        {busy ? (
          <Box marginTop={1}>
            <Text color={uiColor('warning')}>正在创建保险库…</Text>
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

  if (step === 'profileName') {
    return (
      <ScreenFrame
        title={messages.setup.profileNameTitle}
        subtitle={stepLabel}
        footer={'Enter 继续' + backHint}
      >
        <Text dimColor>{messages.setup.profileNameHint}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={profile.displayName}
            onChange={(value) => setProfile((current) => ({ ...current, displayName: value }))}
            onSubmit={(value) => {
              setProfile((current) => ({ ...current, displayName: value.trim() }));
              goNext();
            }}
            onEscape={canGoBack ? goBack : undefined}
            placeholder={messages.setup.profileNamePlaceholder}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (step === 'profileAge') {
    const ageOptions = [
      { value: 'unspecified' as const, label: messages.setup.profileAgeUnspecified },
      { value: 'adult' as const, label: messages.setup.profileAgeAdult },
      { value: 'minor' as const, label: messages.setup.profileAgeMinor },
    ];
    return (
      <ScreenFrame
        title={messages.setup.profileAgeTitle}
        subtitle={stepLabel}
        footer={'↑↓ 选择 · Enter 确认' + backHint}
      >
        <Text dimColor>{messages.setup.profileAgeHint}</Text>
        <Box marginTop={1} flexDirection="column">
          <SelectList
            key="setup-age"
            options={ageOptions}
            onEscape={canGoBack ? goBack : undefined}
            initialIndex={Math.max(
              0,
              ageOptions.findIndex((option) => option.value === profile.ageBand),
            )}
            onSelect={(value) => {
              setProfile((current) => ({ ...current, ageBand: value as AgeBand }));
              goNext();
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (step === 'profileTimezone') {
    return (
      <ScreenFrame
        title={messages.setup.profileTimezoneTitle}
        subtitle={stepLabel}
        footer={'Enter 继续' + backHint}
      >
        <Text dimColor>{messages.setup.profileTimezoneHint}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={profile.timezone}
            onChange={(value) => setProfile((current) => ({ ...current, timezone: value }))}
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (!isValidTimezone(trimmed)) {
                setError('时区不正确。请使用 IANA 名称，例如 Asia/Tokyo 或 UTC。');
                return;
              }
              setError('');
              setProfile((current) => ({ ...current, timezone: trimmed }));
              goNext();
            }}
            placeholder={messages.setup.profileTimezonePlaceholder}
            onEscape={canGoBack ? goBack : undefined}
          />
        </Box>
        {profile.ageBand === 'minor' ? (
          <Box marginTop={1}>
            <Text color={uiColor('warning')}>{messages.setup.profileMinorNotice}</Text>
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

  return (
    <ModelSetup
      service={service}
      initialProfile={initialConfig?.models.profiles[0]}
      initialApiKey={undefined}
      allowSkip
      subtitle={stepLabel}
      onCancel={canGoBack ? goBack : undefined}
      onDone={finishWithModel}
    />
  );
}
