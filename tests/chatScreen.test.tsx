import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppPaths } from '../src/config/paths.js';
import { messages } from '../src/i18n/zh-CN.js';
import type { ChatProvider } from '../src/providers/types.js';
import { AppService } from '../src/services/appService.js';
import type { SafetyEvaluation, SafetyEvaluator } from '../src/services/safetyService.js';
import { ChatScreen } from '../src/ui/screens/ChatScreen.js';
import { ScriptedChatProvider } from './helpers/fakeChatProvider.js';

const TEST_KDF = { N: 1024, r: 8, p: 1, dkLen: 32 } as const;
const PASSPHRASE = 'test passphrase 123';
const roots: string[] = [];
const services: AppService[] = [];

async function setup(
  runs: ConstructorParameters<typeof ScriptedChatProvider>[0] = [
    [{ type: 'delta', text: '我在听。' }, { type: 'done' }],
  ],
  options: { safety?: SafetyEvaluator } = {},
): Promise<{ service: AppService; provider: ScriptedChatProvider }> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-chat-ui-'));
  roots.push(root);
  const paths: AppPaths = {
    data: join(root, 'data'),
    config: join(root, 'config'),
    log: join(root, 'log'),
  };
  const provider = new ScriptedChatProvider(runs);
  const service = new AppService({
    paths,
    kdf: TEST_KDF,
    autoRunPostSession: false,
    chatProviderFactory: (_profile, _apiKey): ChatProvider => provider,
    ...(options.safety !== undefined ? { safetyEvaluatorFactory: () => options.safety } : {}),
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
  return { service, provider };
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

describe('ChatScreen', () => {
  it('sends a message, streams the reply and shows the transcript', async () => {
    const { service } = await setup();
    const session = service.createSession();
    const onExit = vi.fn();
    const onLock = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <ChatScreen
        service={service}
        sessionId={session.id}
        onExit={onExit}
        onLock={onLock}
        onQuit={vi.fn()}
      />,
    );
    await tick();

    expect(lastFrame()).toContain('我在这里');
    stdin.write('今天有点累');
    await tick();
    stdin.write('\r');
    await tick(300);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('今天有点累');
    expect(frame).toContain('我在听。');
    expect(service.getSession(session.id)?.status).toBe('active');
    expect(service.listSessionMessages(session.id)).toHaveLength(3);
    expect(onExit).not.toHaveBeenCalled();

    unmount();
  });

  it('ends the session from the command menu after confirming', async () => {
    const { service } = await setup();
    const session = service.createSession();
    const onExit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <ChatScreen
        service={service}
        sessionId={session.id}
        onExit={onExit}
        onLock={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    await tick();

    stdin.write('今天有点累');
    await tick();
    stdin.write('\r');
    await tick(300);
    expect(lastFrame()).toContain('我在听。');

    stdin.write('\x0b');
    await tick();
    expect(lastFrame()).toContain('会谈菜单');
    stdin.write('\x1b[B');
    await tick(300);
    stdin.write('\r');
    await tick(300);
    expect(lastFrame()).toContain('结束这次会谈？');
    stdin.write('\r');
    await tick(200);

    expect(onExit).toHaveBeenCalledWith(messages.chat.endedNotice);
    expect(service.getSession(session.id)?.status).toBe('ended');

    unmount();
  });

  it('opens an ended session as read-only', async () => {
    const { service } = await setup();
    const session = service.createSession();
    const chat = service.createChat(session.id);
    await chat.send(session.id, '结束前的一句话');
    service.endSession(session.id);

    const { lastFrame, unmount } = render(
      <ChatScreen
        service={service}
        sessionId={session.id}
        onExit={vi.fn()}
        onLock={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('结束前的一句话');
    expect(frame).toContain('只读查看');
    expect(frame).not.toContain('想说点什么');

    unmount();
  });

  it('asks for confirmation before quitting with Ctrl+Q', async () => {
    const { service } = await setup();
    const session = service.createSession();
    const onQuit = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <ChatScreen
        service={service}
        sessionId={session.id}
        onExit={vi.fn()}
        onLock={vi.fn()}
        onQuit={onQuit}
      />,
    );
    await tick();

    stdin.write('\x11');
    await tick();
    expect(lastFrame()).toContain('退出 Lite Therapy？');
    expect(onQuit).not.toHaveBeenCalled();

    stdin.write('\r');
    await tick();
    expect(onQuit).toHaveBeenCalledTimes(1);

    unmount();
  });
});

describe('App chat entry', () => {
  it('starts a new session from home and returns home after Ctrl+C', async () => {
    const { service } = await setup([[{ type: 'delta', text: '我在听。' }, { type: 'done' }]]);
    const { App } = await import('../src/ui/App.js');
    const { stdin, lastFrame, unmount } = render(<App service={service} />);
    await tick(150);

    expect(lastFrame()).toContain('新建会谈');
    stdin.write('\r');
    await tick(150);
    expect(lastFrame()).toContain('我在这里');

    stdin.write('你好');
    await tick();
    stdin.write('\r');
    await tick(300);
    expect(lastFrame()).toContain('我在听。');

    stdin.write('\x03');
    await tick(150);
    expect(lastFrame()).toContain('继续当前会谈');
    expect(lastFrame()).toContain('主页');

    unmount();
  });

  it('shows an imminent crisis card that Esc cannot dismiss', async () => {
    const safety: SafetyEvaluator = {
      evaluate: async (): Promise<SafetyEvaluation> => ({
        level: 'imminent',
        detector: 'rule+model',
        category: 'suicide',
        context: 'self',
        ambiguous: false,
        classifierFailed: false,
        ruleCount: 1,
        confidence: 0.9,
      }),
    };
    const { service } = await setup([[{ type: 'delta', text: '我在听。' }, { type: 'done' }]], {
      safety,
    });
    const session = service.createSession();
    const { stdin, lastFrame, unmount } = render(
      <ChatScreen
        service={service}
        sessionId={session.id}
        onExit={vi.fn()}
        onLock={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    await tick();

    stdin.write('我今晚准备自杀');
    await tick();
    stdin.write('\r');
    await tick(300);
    expect(lastFrame()).toContain('此刻的安全更重要');

    stdin.write('\x1b');
    await tick();
    expect(lastFrame()).toContain('此刻的安全更重要');

    stdin.write('\r');
    await tick();
    expect(lastFrame()).not.toContain('此刻的安全更重要');
    expect(lastFrame()).toContain('本会谈已记录风险线索');

    unmount();
  });

  it('uses a non-blocking notice for third-party concern without a self crisis card', async () => {
    const safety: SafetyEvaluator = {
      evaluate: async (): Promise<SafetyEvaluation> => ({
        level: 'concern',
        detector: 'model',
        category: 'suicide',
        context: 'third_party',
        contexts: ['third_party'],
        ambiguous: false,
        classifierFailed: false,
        ruleCount: 1,
        confidence: 0.9,
      }),
    };
    const { service } = await setup(
      [[{ type: 'delta', text: '我先确认你朋友的安全。' }, { type: 'done' }]],
      {
        safety,
      },
    );
    const session = service.createSession();
    const { stdin, lastFrame, unmount } = render(
      <ChatScreen
        service={service}
        sessionId={session.id}
        onExit={vi.fn()}
        onLock={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    await tick();

    stdin.write('朋友说他想自杀');
    await tick();
    stdin.write('\r');
    await tick(300);
    expect(lastFrame()).not.toContain('此刻的安全更重要');
    expect(lastFrame()).toContain('你提到的是另一个人的风险');
    expect(lastFrame()).toContain('本会谈已记录风险线索');

    unmount();
  });

  it('uses a confirmation notice for a negated concern instead of a crisis card', async () => {
    const safety: SafetyEvaluator = {
      evaluate: async (): Promise<SafetyEvaluation> => ({
        level: 'concern',
        detector: 'rule+model',
        category: 'suicide',
        context: 'negated',
        contexts: ['negated'],
        ambiguous: false,
        classifierFailed: false,
        ruleCount: 1,
        confidence: 0.9,
      }),
    };
    const { service } = await setup(
      [[{ type: 'delta', text: '我先确认你此刻是否安全。' }, { type: 'done' }]],
      {
        safety,
      },
    );
    const session = service.createSession();
    const { stdin, lastFrame, unmount } = render(
      <ChatScreen
        service={service}
        sessionId={session.id}
        onExit={vi.fn()}
        onLock={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    await tick();

    stdin.write('我没有想自杀，只是最近很累');
    await tick();
    stdin.write('\r');
    await tick(300);
    expect(lastFrame()).not.toContain('此刻的安全更重要');
    expect(lastFrame()).toContain('你刚才明确否认');
    expect(lastFrame()).toContain('本会谈已记录风险线索');

    unmount();
  });

  it('shows a notice when the latest context audit reports summary failure', async () => {
    const { service } = await setup([[{ type: 'delta', text: '我在听。' }, { type: 'done' }]]);
    const session = service.createSession();
    vi.spyOn(service, 'listContextAudits').mockReturnValue([
      {
        id: 'audit-1',
        sessionId: session.id,
        messageId: null,
        promptTokens: 10,
        historyTokens: 10,
        historyMessages: 1,
        truncated: true,
        summaryUsed: false,
        memoUsed: false,
        memoryUsed: false,
        warnings: ['summary_failed'],
        entries: [],
        createdAt: '2026-10-26T12:00:00.000Z',
      },
    ]);
    const { stdin, lastFrame, unmount } = render(
      <ChatScreen
        service={service}
        sessionId={session.id}
        onExit={vi.fn()}
        onLock={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    await tick();

    stdin.write('最近有点累');
    await tick();
    stdin.write('\r');
    await tick(300);
    expect(lastFrame()).toContain(messages.chat.summaryFailedNotice);

    unmount();
  });
});
