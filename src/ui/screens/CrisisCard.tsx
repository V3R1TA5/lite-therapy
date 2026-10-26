import { Box, Text } from 'ink';
import type { RiskLevel } from '../../core/safety/types.js';
import { messages } from '../../i18n/zh-CN.js';
import type { CrisisResource, CrisisResources } from '../../services/crisisResources.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';
import { uiColor } from '../theme.js';

export interface CrisisCardProps {
  level: RiskLevel;
  resources: CrisisResources;
  resourcesPath: string;
  resourcesError?: string;
  showingResources: boolean;
  onSafe: () => void;
  onContinue: () => void;
  onViewResources: () => void;
  onBackFromResources: () => void;
  onEnd: () => void;
}

function resourceKey(resource: CrisisResource): string {
  return (
    [
      resource.region,
      resource.emergency,
      resource.crisis_line,
      resource.text_line,
      resource.notes,
      resource.source_url,
      resource.verified_at,
    ]
      .filter((value) => value !== undefined)
      .join('|') || 'resource'
  );
}

function ResourceBlock(props: { resource: CrisisResource; index: number }) {
  const { resource, index } = props;
  const lines: string[] = [];
  lines.push(resource.region ?? messages.crisis.noRegion);
  if (resource.emergency !== undefined) {
    lines.push(messages.crisis.emergency + '：' + resource.emergency);
  }
  if (resource.crisis_line !== undefined) {
    lines.push(messages.crisis.crisisLine + '：' + resource.crisis_line);
  }
  if (resource.text_line !== undefined) {
    lines.push(messages.crisis.textLine + '：' + resource.text_line);
  }
  if (resource.notes !== undefined) {
    lines.push(messages.crisis.notes + '：' + resource.notes);
  }
  if (resource.source_url !== undefined) {
    lines.push(messages.crisis.source + '：' + resource.source_url);
  }
  if (resource.verified_at !== undefined) {
    lines.push(messages.crisis.verifiedAt + '：' + resource.verified_at);
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>
        {index + 1}. {lines[0]}
      </Text>
      {lines.slice(1).map((line) => (
        <Text key={line} wrap="wrap" dimColor>
          {line}
        </Text>
      ))}
    </Box>
  );
}

export function CrisisCard(props: CrisisCardProps) {
  const {
    level,
    resources,
    resourcesPath,
    resourcesError,
    showingResources,
    onSafe,
    onContinue,
    onViewResources,
    onBackFromResources,
    onEnd,
  } = props;
  const imminent = level === 'imminent';

  if (showingResources) {
    return (
      <ScreenFrame title={messages.crisis.resourcesTitle} footer="↑↓ 选择 · Enter 返回">
        {resourcesError !== undefined ? (
          <Text color={uiColor('danger')}>
            {messages.crisis.resourcesError}
            {resourcesError}
          </Text>
        ) : null}
        {resources.resources.length === 0 ? (
          <Box flexDirection="column">
            <Text wrap="wrap">{messages.crisis.resourcesEmpty}</Text>
            <Box marginTop={1}>
              <Text wrap="wrap" dimColor>
                {messages.crisis.resourcesPath}
                {resourcesPath}
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text wrap="wrap" dimColor>
                {messages.crisis.resourcesHint}
              </Text>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            {resources.resources.map((resource, index) => (
              <ResourceBlock key={resourceKey(resource)} resource={resource} index={index} />
            ))}
            <Text dimColor>{messages.crisis.resourcesHint}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <SelectList
            key="crisis-resources-back"
            options={[{ value: 'back', label: messages.crisis.resourcesBack }]}
            onSelect={() => onBackFromResources()}
          />
        </Box>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame
      title={imminent ? messages.crisis.titleImminent : messages.crisis.titleConcern}
      footer={messages.crisis.footer}
    >
      <Text wrap="wrap" bold={imminent} color={imminent ? uiColor('danger') : uiColor('warning')}>
        {imminent ? messages.crisis.bodyImminent : messages.crisis.bodyConcern}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text wrap="wrap">· {messages.crisis.stepEmergency}</Text>
        <Text wrap="wrap">· {messages.crisis.stepTrusted}</Text>
        <Text wrap="wrap">· {messages.crisis.stepNotAlone}</Text>
      </Box>
      <Box marginTop={1}>
        <Text wrap="wrap" dimColor>
          {messages.crisis.limit}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <SelectList
          key="crisis-actions"
          options={[
            { value: 'safe' as const, label: messages.crisis.actionSafe },
            { value: 'continue' as const, label: messages.crisis.actionContinue },
            { value: 'resources' as const, label: messages.crisis.actionResources },
            { value: 'end' as const, label: messages.crisis.actionEnd },
          ]}
          onSelect={(value) => {
            if (value === 'safe') {
              onSafe();
            } else if (value === 'continue') {
              onContinue();
            } else if (value === 'resources') {
              onViewResources();
            } else {
              onEnd();
            }
          }}
        />
      </Box>
    </ScreenFrame>
  );
}
