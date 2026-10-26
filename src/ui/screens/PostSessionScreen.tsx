import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PostSessionJobRecord } from '../../db/repositories/postSessionRepository.js';
import { messages } from '../../i18n/zh-CN.js';
import type { AppService } from '../../services/appService.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { errorMessage } from '../errorMessage.js';
import { uiColor } from '../theme.js';

export interface PostSessionScreenProps {
  service: AppService;
  sessionId: string;
  onBack: () => void;
  onOpenRecords?: () => void;
}

function jobKindLabel(kind: PostSessionJobRecord['kind']): string {
  return (messages.postSession.kinds as Record<string, string>)[kind] ?? kind;
}

function jobStatusLabel(status: PostSessionJobRecord['status']): string {
  return (messages.postSession.statuses as Record<string, string>)[status] ?? status;
}

export function PostSessionScreen(props: PostSessionScreenProps) {
  const { service, sessionId, onBack, onOpenRecords } = props;
  const [jobs, setJobs] = useState<PostSessionJobRecord[]>(() =>
    service.listPostSessionJobs(sessionId),
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(false);

  const refresh = useCallback(() => {
    setJobs(service.listPostSessionJobs(sessionId));
  }, [service, sessionId]);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    const hasQueued = jobs.some((job) => job.status === 'queued');
    if (!hasQueued) {
      return;
    }
    setRunning(true);
    void service
      .runPostSession(sessionId)
      .then((result) => {
        setJobs(result.jobs);
      })
      .catch((runError: unknown) => {
        setError(errorMessage(runError));
        refresh();
      })
      .finally(() => {
        setRunning(false);
      });
  }, [jobs, refresh, service, sessionId]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(refresh, 500);
    return () => clearInterval(timer);
  }, [refresh, running]);

  useInput((_input, key) => {
    if (key.escape && !running) {
      onBack();
    }
  });

  const hasFailed = jobs.some((job) => job.status === 'failed');
  const hasStale = jobs.some((job) => job.status === 'stale');
  const allReady = jobs.length > 0 && jobs.every((job) => job.status === 'ready');
  const completed = jobs.filter((job) => job.status === 'ready').length;

  return (
    <ScreenFrame
      title={messages.postSession.title}
      footer={running ? messages.postSession.runningFooter : messages.postSession.footer}
    >
      {running ? (
        <Text color={uiColor('warning')}>
          {messages.postSession.running} {completed} / {jobs.length}
        </Text>
      ) : null}
      {error.length > 0 ? (
        <Box marginBottom={1}>
          <Text color={uiColor('danger')}>{error}</Text>
        </Box>
      ) : null}
      {jobs.length === 0 ? (
        <Text>{messages.postSession.empty}</Text>
      ) : (
        <Box flexDirection="column">
          {jobs.map((job) => (
            <Box key={job.id} flexDirection="column" marginBottom={1}>
              <Text wrap="wrap">
                {jobStatusLabel(job.status)} · {jobKindLabel(job.kind)} ·{' '}
                {messages.postSession.attempts(job.attempts)}
              </Text>
              {job.error !== null ? (
                <Text
                  color={job.status === 'failed' ? uiColor('danger') : uiColor('muted')}
                  wrap="wrap"
                >
                  {job.error}
                </Text>
              ) : null}
            </Box>
          ))}
        </Box>
      )}
      {allReady ? <Text color={uiColor('success')}>{messages.postSession.complete}</Text> : null}
      {hasStale ? <Text color={uiColor('warning')}>{messages.postSession.staleHint}</Text> : null}
      {!running ? (
        <Box marginTop={1}>
          <SelectList
            key="post-session-actions"
            options={[
              ...(hasFailed
                ? [{ value: 'retry' as const, label: messages.postSession.retry }]
                : []),
              ...(completed > 0 && onOpenRecords !== undefined
                ? [{ value: 'records' as const, label: messages.postSession.records }]
                : []),
              { value: 'back' as const, label: messages.postSession.back },
            ]}
            onSelect={(value) => {
              if (value === 'retry') {
                setRunning(true);
                setError('');
                void service
                  .retryPostSession(sessionId)
                  .then((result) => {
                    setJobs(result.jobs);
                  })
                  .catch((retryError: unknown) => {
                    setError(errorMessage(retryError));
                    refresh();
                  })
                  .finally(() => {
                    setRunning(false);
                  });
              } else if (value === 'records') {
                onOpenRecords?.();
              } else {
                onBack();
              }
            }}
          />
        </Box>
      ) : null}
    </ScreenFrame>
  );
}
