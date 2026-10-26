import { render } from 'ink-testing-library';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CrisisCard } from '../src/ui/screens/CrisisCard.js';

function tick(ms = 60): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function ControlledConcernCard(props: { onSafe: () => void }) {
  const [showingResources, setShowingResources] = useState(false);
  return (
    <CrisisCard
      level="concern"
      resources={{ version: 1, resources: [] }}
      resourcesPath="/tmp/crisis-resources.json"
      showingResources={showingResources}
      onSafe={props.onSafe}
      onContinue={() => undefined}
      onViewResources={() => setShowingResources(true)}
      onBackFromResources={() => setShowingResources(false)}
      onEnd={() => undefined}
    />
  );
}

describe('CrisisCard', () => {
  it('shows generic safety steps and the local resource path when no resources exist', async () => {
    const onSafe = vi.fn();
    const { stdin, lastFrame, unmount } = render(<ControlledConcernCard onSafe={onSafe} />);
    await tick();

    expect(lastFrame()).toContain('先确认一下此刻的安全');
    expect(lastFrame()).toContain('当地急救');
    expect(lastFrame()).toContain('不能到场');
    expect(lastFrame()).toContain('我现在安全');

    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('本地危机资源');
    expect(lastFrame()).toContain('不内置任何热线号码');
    expect(lastFrame()).toContain('/tmp/crisis-resources.json');

    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('先确认一下此刻的安全');

    stdin.write('\r');
    await tick();
    expect(onSafe).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('renders user-provided resources without inventing numbers', async () => {
    const { lastFrame, unmount } = render(
      <CrisisCard
        level="imminent"
        resources={{
          version: 1,
          resources: [
            {
              region: '测试地区',
              crisis_line: '请填写你核对过的号码',
              notes: '只保存在本机。',
              source_url: 'https://example.org',
            },
          ],
        }}
        resourcesPath="/tmp/crisis-resources.json"
        showingResources
        onSafe={vi.fn()}
        onContinue={vi.fn()}
        onViewResources={vi.fn()}
        onBackFromResources={vi.fn()}
        onEnd={vi.fn()}
      />,
    );
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('测试地区');
    expect(frame).toContain('请填写你核对过的号码');
    expect(frame).toContain('只保存在本机');
    expect(frame).not.toContain('110');
    expect(frame).not.toContain('120');

    unmount();
  });
});
