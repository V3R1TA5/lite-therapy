import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppPaths } from '../src/config/paths.js';
import { AppService } from '../src/services/appService.js';
import { SessionListScreen } from '../src/ui/screens/SessionListScreen.js';
import { ScriptedChatProvider } from './helpers/fakeChatProvider.js';

const TEST_KDF = { N: 1024, r: 8, p: 1, dkLen: 32 } as const;
const roots: string[] = [];
const services: AppService[] = [];

async function setup(): Promise<AppService> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-session-list-'));
  roots.push(root);
  const paths: AppPaths = {
    data: join(root, 'data'),
    config: join(root, 'config'),
    log: join(root, 'log'),
  };
  const provider = new ScriptedChatProvider([[{ type: 'delta', text: '好。' }, { type: 'done' }]]);
  const service = new AppService({
    paths,
    kdf: TEST_KDF,
    chatProviderFactory: () => provider,
  });
  services.push(service);
  await service.beginSetup('test passphrase 123');
  await service.completeOnboarding({
    profile: {
      displayName: '',
      locale: 'zh-CN',
      timezone: 'UTC',
      ageBand: 'unspecified',
    },
    models: [
      {
        id: 'primary',
        label: 'Fake',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        model: 'fake-model',
      },
    ],
  });
  return service;
}

function tick(ms = 100): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

afterEach(() => {
  for (const service of services.splice(0)) {
    service.shutdown();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('SessionListScreen', () => {
  it('deletes the highlighted session after confirmation', async () => {
    const service = await setup();
    const first = service.createSession();
    const chat = service.createChat(first.id);
    await chat.send(first.id, '第一场');
    service.endSession(first.id);
    const second = service.createSession();

    const { stdin, lastFrame, unmount } = render(
      <SessionListScreen service={service} onOpenChat={vi.fn()} onBack={vi.fn()} />,
    );
    await tick();

    expect(lastFrame()).toContain('会谈列表');
    expect(lastFrame()).toContain(second.title);
    stdin.write('d');
    await tick();
    expect(lastFrame()).toContain('删除「');
    stdin.write('\r');
    await tick(150);

    expect(lastFrame()).toContain('会谈已删除');
    expect(service.getSession(second.id)).toBeNull();
    expect(service.listSessions()).toHaveLength(1);

    unmount();
  });
});
