import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { messages } from '../../i18n/zh-CN.js';
import type { AppService } from '../../services/appService.js';
import { type DoctorCheck, runDiagnostics } from '../../services/doctor.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { errorMessage } from '../errorMessage.js';
import { uiColor } from '../theme.js';

export interface DiagnosticsScreenProps {
  service: AppService;
  onBack: () => void;
}

export function DiagnosticsScreen(props: DiagnosticsScreenProps) {
  const { service, onBack } = props;
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    runDiagnostics({ paths: service.appPaths })
      .then((result) => {
        if (!cancelled) {
          setChecks(result);
        }
      })
      .catch((diagnosticsError: unknown) => {
        if (!cancelled) {
          setError(errorMessage(diagnosticsError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  if (error.length > 0) {
    return (
      <ScreenFrame title={messages.settings.diagnostics} footer="Enter 返回">
        <Text color={uiColor('danger')}>{error}</Text>
        <Box marginTop={1}>
          <SelectList
            key="diagnostics-error-back"
            options={[{ value: 'back', label: messages.common.back }]}
            onSelect={onBack}
          />
        </Box>
      </ScreenFrame>
    );
  }

  if (checks === null) {
    return (
      <ScreenFrame title={messages.settings.diagnostics} footer="Enter 返回">
        <Text color={uiColor('warning')}>{messages.settings.diagnosticsRunning}</Text>
      </ScreenFrame>
    );
  }

  const failed = checks.filter((check) => !check.ok);
  return (
    <ScreenFrame
      title={messages.settings.diagnostics}
      subtitle={messages.settings.diagnosticsSummary(checks.length - failed.length, checks.length)}
      footer="Enter 返回"
    >
      <Box flexDirection="row" flexWrap="wrap">
        {checks.map((check) => (
          <Box key={check.name} width="50%">
            <Text color={check.ok ? undefined : uiColor('danger')} dimColor={check.ok}>
              {check.ok ? 'PASS' : 'FAIL'} {check.name}
            </Text>
          </Box>
        ))}
      </Box>
      {failed.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={uiColor('warning')}>{messages.settings.diagnosticsFailed}</Text>
          {failed.slice(0, 4).map((check) => (
            <Text key={check.name} color={uiColor('danger')} wrap="wrap">
              {check.name} · {check.detail}
            </Text>
          ))}
          {failed.length > 4 ? (
            <Text dimColor>{messages.settings.diagnosticsMore(failed.length - 4)}</Text>
          ) : null}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={uiColor('success')}>{messages.settings.diagnosticsAllPass}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <SelectList
          key="diagnostics-back"
          options={[{ value: 'back', label: messages.common.back }]}
          onSelect={onBack}
        />
      </Box>
    </ScreenFrame>
  );
}
