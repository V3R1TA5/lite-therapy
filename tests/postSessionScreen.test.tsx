import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppPaths } from '../src/config/paths.js';
import type { ChatProvider } from '../src/providers/types.js';
import { AppService } from '../src/services/appService.js';
import { InternalRecordsScreen } from '../src/ui/screens/InternalRecordsScreen.js';
import { PostSessionScreen } from '../src/ui/screens/PostSessionScreen.js';
import { ScriptedChatProvider } from './helpers/fakeChatProvider.js';

const TEST_KDF = { N: 1024, r: 8, p: 1, dkLen: 32 } as const;
const PASSPHRASE = 'progress passphrase 123';
const VALID_MEMO =
  '主题：疲惫\n重要背景：工作忙。\n偏好与资源：愿意休息。\n未完成：没有安排休息。\n下次可以：谈边界。';

const roots: string[] = [];
const services: AppService[] = [];

async function setup(
  memo: string,
  retryMemo?: string,
): Promise<{ service: AppService; sessionId: string }> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-progress-'));
  roots.push(root);
  const paths: AppPaths = {
    data: join(root, 'data'),
    config: join(root, 'config'),
    log: join(root, 'log'),
  };
  const runs: ConstructorParameters<typeof ScriptedChatProvider>[0] = [
    [{ type: 'delta', text: '我在听。' }, { type: 'done' }],
    [{ type: 'delta', text: '主题：疲惫' }, { type: 'done' }],
    [{ type: 'delta', text: '纵向理解：疲惫与边界有关。' }, { type: 'done' }],
    [{ type: 'delta', text: '督导：先放慢。' }, { type: 'done' }],
    ...(retryMemo !== undefined
      ? [
          [{ type: 'delta' as const, text: memo }, { type: 'done' as const }],
          [{ type: 'delta' as const, text: memo }, { type: 'done' as const }],
          [{ type: 'delta' as const, text: memo }, { type: 'done' as const }],
        ]
      : [[{ type: 'delta' as const, text: memo }, { type: 'done' as const }]]),
    [{ type: 'delta', text: '小林，今天辛苦了。' }, { type: 'done' }],
    [{ type: 'delta', text: '[]' }, { type: 'done' }],
  ];
  if (retryMemo !== undefined) {
    runs.push([{ type: 'delta', text: retryMemo }, { type: 'done' }]);
  }
  const provider = new ScriptedChatProvider(runs);
  const service = new AppService({
    paths,
    kdf: TEST_KDF,
    postSessionRetryDelaysMs: [0, 0, 0],
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
  return { service, sessionId: session.id };
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

describe('PostSessionScreen', () => {
  it('automatically runs queued jobs and shows completion', async () => {
    const { service, sessionId } = await setup(VALID_MEMO);
    const { lastFrame, unmount } = render(
      <PostSessionScreen service={service} sessionId={sessionId} onBack={vi.fn()} />,
    );
    await tick(350);

    expect(lastFrame()).toContain('会后整理');
    expect(lastFrame()).toContain('整理完成');
    expect(service.listPostSessionJobs(sessionId).every((job) => job.status === 'ready')).toBe(
      true,
    );

    unmount();
  });

  it('shows a failed task and retries only that task', async () => {
    const { service, sessionId } = await setup('缺少结构的备忘录', VALID_MEMO);
    const { stdin, lastFrame, unmount } = render(
      <PostSessionScreen service={service} sessionId={sessionId} onBack={vi.fn()} />,
    );
    await tick(350);

    expect(lastFrame()).toContain('失败');
    expect(lastFrame()).toContain('重试失败任务');

    stdin.write('\r');
    await tick(400);
    expect(lastFrame()).toContain('整理完成');
    expect(service.listPostSessionJobs(sessionId).every((job) => job.status === 'ready')).toBe(
      true,
    );

    unmount();
  });

  it('shows internal notes read-only after a successful run', async () => {
    const { service, sessionId } = await setup(VALID_MEMO);
    await service.runPostSession(sessionId);
    const onBack = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <InternalRecordsScreen service={service} sessionId={sessionId} onBack={onBack} />,
    );
    await tick();

    expect(lastFrame()).toContain('不是对你的结论');
    expect(lastFrame()).toContain('单次记录');
    expect(lastFrame()).toContain('纵向理解');
    expect(lastFrame()).toContain('独立督导');
    expect(lastFrame()).toContain('备忘录');

    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('主题：疲惫');
    stdin.write('\x1b');
    await tick();
    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('纵向理解：疲惫');
    stdin.write('\x1b');
    await tick();
    stdin.write('\x1b');
    await tick();
    expect(onBack).toHaveBeenCalledTimes(1);

    unmount();
  });
});
