import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { uiColor } from '../theme.js';

export interface ScreenFrameProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: string;
}

export function ScreenFrame(props: ScreenFrameProps) {
  const { title, subtitle, children, footer } = props;
  return (
    <Box flexDirection="column" width="100%" height="100%" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={uiColor('accent')}>
          {title}
        </Text>
        {subtitle ? <Text dimColor> · {subtitle}</Text> : null}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
      {footer ? (
        <Box marginTop={1}>
          <Text dimColor>{footer}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
