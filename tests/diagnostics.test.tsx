import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppPaths } from '../src/config/paths.js';
import { AppService } from '../src/services/appService.js';
import { DiagnosticsScreen } from '../src/ui/screens/DiagnosticsScreen.js';

const roots: string[] = [];

function makeService(): AppService {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-diag-ui-'));
  roots.push(root);
  const paths: AppPaths = {
    data: join(root, 'data'),
    config: join(root, 'config'),
    log: join(root, 'log'),
  };
  return new AppService({ paths });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('DiagnosticsScreen', () => {
  it('runs checks and reports the pass count', async () => {
    const service = makeService();
    const { lastFrame, unmount } = render(
      <DiagnosticsScreen service={service} onBack={() => undefined} />,
    );

    await new Promise((resolve) => setTimeout(resolve, 700));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('系统自检');
    expect(frame).toContain('PASS node');
    expect(frame).toContain('项通过');

    unmount();
  });
});
