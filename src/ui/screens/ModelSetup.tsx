import { Box, Text } from 'ink';
import { useState } from 'react';
import type { ModelKind, ModelProfile } from '../../config/appConfig.js';
import { normalizeBaseUrl } from '../../core/endpoint.js';
import { messages } from '../../i18n/zh-CN.js';
import type { ConnectionTestResult } from '../../providers/connectionTest.js';
import type { AppService } from '../../services/appService.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { SingleLineInput } from '../components/SingleLineInput.js';
import { uiColor } from '../theme.js';

export interface ModelSetupResult {
  profile: ModelProfile | null;
  apiKey?: string;
  tested: boolean;
}

export interface ModelSetupProps {
  service: AppService;
  onDone: (result: ModelSetupResult) => void;
  onCancel?: () => void;
  initialProfile?: ModelProfile;
  initialApiKey?: string;
  allowSkip?: boolean;
  subtitle?: string;
}

type Step = 'kind' | 'baseUrl' | 'modelName' | 'apiKey' | 'test';

type TestState = { status: 'running' } | { status: 'done'; result: ConnectionTestResult };

export function ModelSetup(props: ModelSetupProps) {
  const {
    service,
    onDone,
    onCancel,
    initialProfile,
    initialApiKey,
    allowSkip = true,
    subtitle,
  } = props;

  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<ModelKind>(initialProfile?.kind ?? 'openai-compatible');
  const [baseUrl, setBaseUrl] = useState(initialProfile?.baseUrl ?? '');
  const [modelName, setModelName] = useState(initialProfile?.model ?? '');
  const [apiKey, setApiKey] = useState(initialApiKey ?? '');
  const [pendingProfile, setPendingProfile] = useState<ModelProfile | null>(null);
  const [testState, setTestState] = useState<TestState>({ status: 'running' });
  const [error, setError] = useState('');

  const makeProfile = (model: string): ModelProfile => ({
    id: initialProfile?.id ?? 'primary',
    label: kind === 'ollama' ? messages.model.labelOllama : messages.model.labelOpenAI,
    kind,
    baseUrl: normalizeBaseUrl(baseUrl),
    model,
  });

  const buildProfile = (): ModelProfile => makeProfile(modelName.trim());

  const runTest = async (profile: ModelProfile, keyOverride?: string) => {
    setTestState({ status: 'running' });
    const key = (keyOverride ?? apiKey).trim();
    try {
      const result = await service.testConnection(profile, key || undefined);
      setTestState({ status: 'done', result });
    } catch (testError) {
      setTestState({
        status: 'done',
        result: {
          ok: false,
          method: 'none',
          detail: testError instanceof Error ? testError.message : messages.common.unknownError,
        },
      });
    }
  };

  const beginTest = (profileOverride?: ModelProfile, keyOverride?: string) => {
    let profile: ModelProfile;
    try {
      profile = profileOverride ?? buildProfile();
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : messages.common.invalidInput);
      return;
    }
    setError('');
    setPendingProfile(profile);
    setStep('test');
    void runTest(profile, keyOverride);
  };

  const submitBaseUrl = (value: string) => {
    try {
      setBaseUrl(normalizeBaseUrl(value));
      setError('');
      setStep('modelName');
    } catch (urlError) {
      setError(urlError instanceof Error ? urlError.message : messages.common.invalidInput);
    }
  };

  const submitModelName = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setError('模型名称不能为空。');
      return;
    }
    setModelName(trimmed);
    setError('');
    if (kind === 'ollama') {
      try {
        beginTest(makeProfile(trimmed));
      } catch (buildError) {
        setError(buildError instanceof Error ? buildError.message : messages.common.invalidInput);
      }
    } else {
      setStep('apiKey');
    }
  };

  const kindOptions = [
    {
      value: 'openai-compatible' as const,
      label: messages.model.kindOpenAI,
      hint: messages.model.kindOpenAIDesc,
    },
    {
      value: 'deepseek' as const,
      label: messages.model.kindDeepseek,
      hint: messages.model.kindDeepseekDesc,
    },
    {
      value: 'ollama' as const,
      label: messages.model.kindOllama,
      hint: messages.model.kindOllamaDesc,
    },
    ...(allowSkip
      ? [
          {
            value: 'skip' as const,
            label: messages.model.kindSkip,
            hint: messages.model.kindSkipDesc,
          },
        ]
      : []),
    ...(onCancel ? [{ value: 'cancel' as const, label: messages.model.cancel }] : []),
  ];

  if (step === 'kind') {
    return (
      <ScreenFrame
        title={messages.model.kindTitle}
        subtitle={subtitle}
        footer={messages.common.enter}
      >
        <Text>{messages.setup.modelIntro}</Text>
        <Box marginTop={1} flexDirection="column">
          <SelectList
            key="model-kind"
            options={kindOptions}
            onSelect={(value) => {
              if (value === 'skip') {
                onDone({ profile: null, tested: false });
                return;
              }
              if (value === 'cancel') {
                onCancel?.();
                return;
              }
              if (value === 'deepseek') {
                setKind('openai-compatible');
                setBaseUrl('https://api.deepseek.com/v1');
                setModelName('deepseek-flash');
                setStep('apiKey');
                return;
              }
              setKind(value);
              setBaseUrl(
                value === 'ollama'
                  ? 'http://127.0.0.1:11434/v1'
                  : initialProfile?.kind === 'openai-compatible'
                    ? initialProfile.baseUrl
                    : 'https://api.openai.com/v1',
              );
              setStep('baseUrl');
            }}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (step === 'baseUrl') {
    return (
      <ScreenFrame
        title={messages.model.baseUrlTitle}
        subtitle={subtitle}
        footer="Enter 继续 · Esc 返回"
      >
        <Text dimColor>{messages.model.baseUrlHint}</Text>
        <Box marginTop={1} flexDirection="column">
          <SingleLineInput
            value={baseUrl}
            onChange={setBaseUrl}
            onSubmit={submitBaseUrl}
            onEscape={() => setStep('kind')}
            placeholder={messages.model.baseUrlPlaceholder}
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

  if (step === 'modelName') {
    return (
      <ScreenFrame
        title={messages.model.modelNameTitle}
        subtitle={subtitle}
        footer="Enter 继续 · Esc 返回"
      >
        <Text dimColor>{messages.model.modelNameHint}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={modelName}
            onChange={setModelName}
            onSubmit={submitModelName}
            onEscape={() => setStep('baseUrl')}
            placeholder={messages.model.modelNamePlaceholder}
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

  if (step === 'apiKey') {
    return (
      <ScreenFrame
        title={messages.model.apiKeyTitle}
        subtitle={subtitle}
        footer="Enter 测试连接 · Esc 返回"
      >
        <Text dimColor>{messages.model.apiKeyHint}</Text>
        <Box marginTop={1}>
          <SingleLineInput
            value={apiKey}
            onChange={setApiKey}
            onSubmit={(value) => {
              setApiKey(value);
              beginTest(undefined, value);
            }}
            onEscape={() => setStep('modelName')}
            placeholder={messages.model.apiKeyPlaceholder}
            mask
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>留空也可以继续。Key 不会显示在界面上。</Text>
        </Box>
      </ScreenFrame>
    );
  }

  const testOptions = [
    { value: 'save' as const, label: messages.model.saveAndUse },
    { value: 'retest' as const, label: messages.model.retest },
    { value: 'edit' as const, label: messages.model.editAgain },
    ...(onCancel ? [{ value: 'cancel' as const, label: messages.model.cancel }] : []),
  ];

  return (
    <ScreenFrame title={messages.model.testTitle} subtitle={subtitle} footer="Enter 确认">
      <Text dimColor>
        {pendingProfile?.kind === 'ollama'
          ? messages.model.labelOllama
          : messages.model.labelOpenAI}
      </Text>
      <Text>{pendingProfile?.baseUrl ?? ''}</Text>
      <Text dimColor>{pendingProfile?.model ?? ''}</Text>
      <Box marginTop={1}>
        {testState.status === 'running' ? (
          <Text color={uiColor('warning')}>{messages.model.testing}</Text>
        ) : testState.result.ok ? (
          <Text color={uiColor('success')}>{messages.model.testSuccess}</Text>
        ) : (
          <Text color={uiColor('danger')}>{messages.model.testFailure}</Text>
        )}
      </Box>
      {testState.status === 'done' ? (
        <Box marginTop={1}>
          <Text dimColor>{testState.result.detail}</Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <SelectList
          key="model-test"
          options={testOptions}
          isActive={testState.status === 'done'}
          onSelect={(value) => {
            if (value === 'save') {
              onDone({
                profile: pendingProfile,
                ...(apiKey.trim().length > 0 ? { apiKey: apiKey.trim() } : {}),
                tested: testState.status === 'done' && testState.result.ok,
              });
              return;
            }
            if (value === 'retest' && pendingProfile) {
              void runTest(pendingProfile);
              return;
            }
            if (value === 'edit') {
              setStep('kind');
              return;
            }
            if (value === 'cancel') {
              onCancel?.();
            }
          }}
        />
      </Box>
    </ScreenFrame>
  );
}
