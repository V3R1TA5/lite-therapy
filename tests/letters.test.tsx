import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppPaths } from '../src/config/paths.js';
import type { ChatProvider } from '../src/providers/types.js';
import { AppService } from '../src/services/appService.js';
import { LettersScreen } from '../src/ui/screens/LettersScreen.js';
import { ScriptedChatProvider } from './helpers/fakeChatProvider.js';

const TEST_KDF = { N: 1024, r: 8, p: 1, dkLen: 32 } as const;
const PASSPHRASE = 'letters passphrase 123';
const roots: string[] = [];
const services: AppService[] = [];

async function setup(): Promise<AppService> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-letters-'));
  roots.push(root);
  const paths: AppPaths = {
    data: join(root, 'data'),
    config: join(root, 'config'),
    log: join(root, 'log'),
  };
  const provider = new ScriptedChatProvider([
    [{ type: 'delta', text: '我在听。' }, { type: 'done' }],
    [{ type: 'delta', text: '主题：疲惫' }, { type: 'done' }],
    [{ type: 'delta', text: '纵向理解：疲惫。' }, { type: 'done' }],
    [{ type: 'delta', text: '督导：放慢。' }, { type: 'done' }],
    [
      {
        type: 'delta',
        text: '主题：疲惫\n重要背景：工作忙。\n偏好与资源：愿意休息。\n未完成：没有安排休息。\n下次可以：谈边界。',
      },
      { type: 'done' },
    ],
    [{ type: 'delta', text: '小林，今天辛苦了。' }, { type: 'done' }],
    [{ type: 'delta', text: '[]' }, { type: 'done' }],
  ]);
  const service = new AppService({
    paths,
    kdf: TEST_KDF,
    chatProviderFactory: (_profile, _apiKey): ChatProvider => provider,
  });
  services.push(service);
  await service.beginSetup(PASSPHRASE);
  await service.completeOnboarding({
    profile: {
      displayName: '小林',
      locale: 'zh-CN',
      timezone: 'Asia/Tokyo',
      ageBand: 'adult',
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
  const session = service.createSession();
  const chat = service.createChat(session.id);
  await chat.send(session.id, '今天有点累');
  service.endSession(session.id);
  const result = await service.runPostSession(session.id);
  expect(result.jobs.every((job) => job.status === 'ready')).toBe(true);
  return service;
}

function tick(ms = 80): Promise<void> {
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

describe('LettersScreen', () => {
  it('shows unread letters, opens one, marks it read and returns', async () => {
    const service = await setup();
    expect(service.countUnreadLetters()).toBe(1);
    const onBack = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <LettersScreen service={service} onBack={onBack} />,
    );
    await tick();

    expect(lastFrame()).toContain('来信');
    expect(lastFrame()).toContain('未读');
    expect(lastFrame()).toContain('今天辛苦了');

    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('小林，今天辛苦了。');
    expect(service.countUnreadLetters()).toBe(0);

    stdin.write('\x1b');
    await tick();
    expect(lastFrame()).toContain('已读');

    stdin.write('\x1b');
    await tick();
    expect(onBack).toHaveBeenCalledTimes(1);

    unmount();
  });
});
