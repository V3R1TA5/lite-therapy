import { Box, Text, useInput } from 'ink';
import { messages } from '../../i18n/zh-CN.js';
import { ScreenFrame } from '../components/ScreenFrame.js';
import { SelectList } from '../components/SelectList.js';

export interface HelpScreenProps {
  onBack: () => void;
}

export function HelpScreen(props: HelpScreenProps) {
  const { onBack } = props;

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    }
  });

  return (
    <ScreenFrame title={messages.help.title} footer={messages.help.footer}>
      <Text wrap="wrap" dimColor>
        {messages.help.intro}
      </Text>
      {messages.help.sections.map((section) => (
        <Box key={section.title} marginTop={1} flexDirection="column">
          <Text bold>{section.title}</Text>
          {section.lines.map((line) => (
            <Text key={line} wrap="wrap" dimColor>
              · {line}
            </Text>
          ))}
        </Box>
      ))}
      <Box marginTop={1}>
        <SelectList
          key="help-back"
          options={[{ value: 'back' as const, label: messages.help.footer }]}
          onSelect={() => onBack()}
        />
      </Box>
    </ScreenFrame>
  );
}
