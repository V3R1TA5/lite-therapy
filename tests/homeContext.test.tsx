import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppPaths } from '../src/config/paths.js';
import { messages } from '../src/i18n/zh-CN.js';
import type { ChatProvider } from '../src/providers/types.js';
import { AppService } from '../src/services/appService.js';
import { HomeScreen } from '../src/ui/screens/HomeScreen.js';
import { ScriptedChatProvider } from './helpers/fakeChatProvider.js';

const TEST_KDF = { N: 1024, r: 8, p: 1, dkLen: 32 } as const;
const PASSPHRASE = 'home context passphrase';
const roots: string[] = [];
const services: AppService[] = [];

async function setup(): Promise<{ service: AppService; sessionId: string }> {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-home-context-'));
  roots.push(root);
  const paths: AppPaths = {
    data: join(root, 'data'),
    config: join(root, 'config'),
    log: join(root, 'log'),
  };
  const provider = new ScriptedChatProvider([
    [{ type: 'delta', text: '我在听。' }, { type: 'done' }],
    [{ type: 'delta', text: '主题：疲惫' }, { type: 'done' }],
    [{ type: 'delta', text: '纵向理解：疲惫与边界有关。' }, { type: 'done' }],
    [{ type: 'delta', text: '督导：放慢。' }, { type: 'done' }],
    [
      {
        type: 'delta',
        text: '主题：疲惫\n重要背景：工作很忙。\n偏好与资源：愿意休息。\n未完成：没有安排休息。\n下次可以：谈休息边界。',
      },
      { type: 'done' },
    ],
    [{ type: 'delta', text: '小林，辛苦了。' }, { type: 'done' }],
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
  return { service, sessionId: session.id };
}

function tick(ms = 80): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function down(stdin: { write: (value: string) => void }, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    stdin.write('\x1b[B');
    await tick(20);
  }
}

function Harness(props: { service: AppService }) {
  const [config, setConfig] = useState(() => props.service.getConfig());
  if (config === null) {
    return null;
  }
  return (
    <HomeScreen
      service={props.service}
      config={config}
      onConfigChange={setConfig}
      onLock={vi.fn()}
      onQuit={vi.fn()}
      onOpenChat={vi.fn()}
      onOpenSessions={vi.fn()}
      onOpenPostSession={vi.fn()}
    />
  );
}

afterEach(() => {
  for (const service of services.splice(0)) {
    service.shutdown();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Home context settings', () => {
  it('saves a budget preset and shows a redacted audit view', async () => {
    const { service } = await setup();
    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();

    // 主页：继续当前 / 会谈列表 / 来信 / 记忆 / 设置（禁用项会被跳过）
    await down(stdin, 2);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('设置');

    // 设置：自动锁定 / 上下文预算 / 最近上下文审计
    await down(stdin, 1);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('上下文预算');
    expect(lastFrame()).toContain('保守（24k / 12k / 10k）');

    await down(stdin, 1);
    stdin.write('\r');
    await tick(200);
    expect(lastFrame()).toContain('上下文预算已更新');
    expect(service.getConfig()?.context.historyTokens).toBe(32_000);

    // 保存后回到设置，打开最近审计
    await down(stdin, 2);
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('最近上下文审计');
    expect(frame).toContain('消息审计');
    expect(frame).toContain('请求');
    expect(frame).not.toContain('我在听。');

    unmount();
  });

  it('asks whether to carry the latest ready memo into a new session', async () => {
    const { service, sessionId } = await setup();
    service.endSession(sessionId);
    const post = await service.runPostSession(sessionId);
    expect(post.jobs.every((job) => job.status === 'ready')).toBe(true);
    const memo = service.getLatestReadyMemo();
    expect(memo).not.toBeNull();

    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();
    // 无未完成会谈时，首项是“新建会谈”。
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('要带入上次的理解吗？');
    expect(lastFrame()).toContain('主题：疲惫');

    stdin.write('\r');
    await tick(100);
    const open = service.getOpenSession();
    expect(open).not.toBeNull();
    expect(service.getSessionMemo(open?.id ?? '')?.memoId).toBe(memo?.id);

    unmount();
  });

  it('opens the command palette with Ctrl+K and closes with Esc', async () => {
    const { service } = await setup();
    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();

    stdin.write('\x0b');
    await tick();
    expect(lastFrame()).toContain('命令面板');
    expect(lastFrame()).toContain('备份与恢复');

    stdin.write('\x1b');
    await tick();
    expect(lastFrame()).toContain('主页');

    unmount();
  });

  it('toggles theme from settings and persists it', async () => {
    const { service } = await setup();
    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();

    stdin.write('s');
    await tick();
    await down(stdin, 4);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('主题已更新');
    expect(service.getConfig()?.theme).toBe('light');

    unmount();
  });

  it('browses backups and returns with Esc', async () => {
    const { service } = await setup();
    await service.createBackup(PASSPHRASE);
    expect(service.listManualBackups()).toHaveLength(1);
    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();

    stdin.write('s');
    await tick();
    await down(stdin, 6);
    expect(lastFrame()).toContain('› 查看备份与恢复');
    stdin.write('\r');
    await tick(200);
    expect(lastFrame()).toContain('备份与恢复');

    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('恢复说明');
    expect(lastFrame()).toContain('恢复步骤');

    stdin.write('\x1b');
    await tick();
    expect(lastFrame()).toContain('备份与恢复');
    stdin.write('\x1b');
    await tick();
    expect(lastFrame()).toContain('设置');

    unmount();
  });

  it('opens help with ? and returns with Esc', async () => {
    const { service } = await setup();
    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();

    stdin.write('?');
    await tick();
    expect(lastFrame()).toContain('帮助与键位');
    expect(lastFrame()).toContain('危机卡');
    expect(lastFrame()).toContain('Ctrl+K 命令面板');

    stdin.write('\x1b');
    await tick();
    expect(lastFrame()).toContain('主页');

    unmount();
  });

  it('shows the wipe warning and can cancel without deleting data', async () => {
    const { service } = await setup();
    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();

    stdin.write('s');
    await tick();
    await down(stdin, 8);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('这会删除数据库');
    expect(lastFrame()).toContain('SSD');

    stdin.write('\x1b');
    await tick();
    expect(lastFrame()).toContain('设置');
    expect(service.getConfig()).not.toBeNull();

    unmount();
  });

  it('opens the restore password step and backs out without restoring', async () => {
    const { service } = await setup();
    await service.createBackup(PASSPHRASE);
    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();

    stdin.write('s');
    await tick();
    await down(stdin, 6);
    stdin.write('\r');
    await tick(200);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('恢复说明');
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('恢复前确认备份密码');

    stdin.write('\x1b');
    await tick();
    expect(lastFrame()).toContain('恢复说明');
    expect(service.getConfig()).not.toBeNull();

    unmount();
  });

  it('exports all data from settings after password confirmation', async () => {
    const { service } = await setup();
    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();

    stdin.write('s');
    await tick();
    await down(stdin, 7);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('包含档案、模型配置');

    stdin.write(PASSPHRASE + '\r');
    await tick(300);
    expect(lastFrame()).toContain('全部数据已导出');
    expect(lastFrame()).toContain('lite-therapy-all-');

    unmount();
  });

  it('warns after changing the embedding model', async () => {
    const { service } = await setup();
    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();

    stdin.write('s');
    await tick();
    await down(stdin, 3);
    stdin.write('\r');
    await tick();
    await down(stdin, 2);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain(messages.settings.memoryEmbedding);

    stdin.write('test-embedding-model\r');
    await tick(300);
    expect(service.getConfig()?.memory.embeddingModel).toBe('test-embedding-model');
    expect(lastFrame()).toContain('模型或端点变化会清空旧向量');

    unmount();
  });

  it('enables auto-unlock from settings', async () => {
    const { service } = await setup();
    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();

    stdin.write('s');
    await tick();
    await down(stdin, 16);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain(messages.settings.autoUnlockEnableTitle);

    stdin.write(PASSPHRASE + '\r');
    await tick(300);
    expect(service.hasAutoUnlock()).toBe(true);
    expect(lastFrame()).toContain(messages.settings.autoUnlockEnabled);

    unmount();
  });

  it('saves an independent embedding endpoint from memory settings', async () => {
    const { service } = await setup();
    const { stdin, lastFrame, unmount } = render(<Harness service={service} />);
    await tick();

    stdin.write('s');
    await tick();
    await down(stdin, 3);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain(messages.settings.memorySettingsTitle);

    await down(stdin, 3);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain(messages.settings.memoryEmbeddingBaseUrl);

    stdin.write('http://127.0.0.1:11434/v1\r');
    await tick(300);
    expect(service.getConfig()?.memory.embeddingBaseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(lastFrame()).toContain('模型或端点变化会清空旧向量');

    unmount();
  });
});
