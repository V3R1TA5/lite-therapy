import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppPaths } from '../src/config/paths.js';
import { AppService } from '../src/services/appService.js';
import { LockoutGate } from '../src/services/lockout.js';
import { App } from '../src/ui/App.js';

const TEST_KDF = { N: 1024, r: 8, p: 1, dkLen: 32 } as const;
const roots: string[] = [];
const services: AppService[] = [];

function makeService(): AppService {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-app-'));
  roots.push(root);
  const paths: AppPaths = {
    data: join(root, 'data'),
    config: join(root, 'config'),
    log: join(root, 'log'),
  };
  const service = new AppService({
    paths,
    kdf: TEST_KDF,
    lockout: new LockoutGate({ baseMs: 1, maxMs: 1 }),
  });
  services.push(service);
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

describe('App', () => {
  it('opens the first-run consent screen on a fresh data directory', async () => {
    const service = makeService();
    const { lastFrame, unmount } = render(<App service={service} />);
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Lite Therapy');
    expect(frame).toContain('先确认几件事');
    expect(frame).toContain('知微是 AI');
    expect(frame).toContain('我已阅读并理解');

    unmount();
  });

  it('shows the lock screen when a vault already exists', async () => {
    const service = makeService();
    await service.beginSetup('test passphrase 123');
    service.shutdown();
    await service.unlock('test passphrase 123');
    await service.completeOnboarding({
      profile: {
        displayName: '小林',
        locale: 'zh-CN',
        timezone: 'Asia/Tokyo',
        ageBand: 'adult',
      },
      models: [],
    });
    service.lock();

    const { lastFrame, unmount } = render(<App service={service} />);
    await tick();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('已锁定');
    expect(frame).toContain('启动密码');
    expect(frame).toContain('恢复短语');

    unmount();
  });

  it('walks a fresh setup through passphrase and recovery phrase', async () => {
    const service = makeService();
    const { stdin, lastFrame, unmount } = render(<App service={service} />);
    await tick();

    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('选择解锁方式');
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('设置启动密码');

    stdin.write('test passphrase 123');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('再输入一次');

    stdin.write('test passphrase 123');
    await tick();
    stdin.write('\r');
    await tick(300);
    expect(lastFrame()).toContain('恢复短语');
    expect(lastFrame()).toContain('不要截图');

    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('确认已抄写');
    expect(lastFrame()).toContain('第 1 / 3 个词');

    unmount();
  });

  it('walks back through the security steps with Esc', async () => {
    const service = makeService();
    const { stdin, lastFrame, unmount } = render(<App service={service} />);
    await tick();

    stdin.write('\r');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('test passphrase 123\r');
    await tick();
    stdin.write('test passphrase 123\r');
    await tick(300);
    expect(lastFrame()).toContain('恢复短语');

    stdin.write('\x1b');
    await tick();
    expect(lastFrame()).toContain('再输入一次');

    stdin.write('\x1b');
    await tick();
    expect(lastFrame()).toContain('设置启动密码');

    unmount();
  });

  it('sets up with the auto-unlock choice from the wizard', async () => {
    const service = makeService();
    const { stdin, lastFrame, unmount } = render(<App service={service} />);
    await tick();

    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('选择解锁方式');
    stdin.write('\x1b[B');
    await tick();
    stdin.write('\x1b[B');
    await tick();
    stdin.write('\r');
    await tick(400);

    expect(lastFrame()).toContain('怎么称呼你');
    expect(service.hasAutoUnlock()).toBe(true);

    unmount();
  });

  it('sets up with password but skips the recovery phrase', async () => {
    const service = makeService();
    const { stdin, lastFrame, unmount } = render(<App service={service} />);
    await tick();

    stdin.write('\r');
    await tick();
    stdin.write('\x1b[B');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('test passphrase 123\r');
    await tick();
    stdin.write('test passphrase 123\r');
    await tick(400);

    expect(lastFrame()).toContain('怎么称呼你');
    expect(lastFrame()).not.toContain('恢复短语');
    expect(service.hasAutoUnlock()).toBe(false);

    unmount();
  });

  it('auto-unlocks into home when the local key exists', async () => {
    const service = makeService();
    await service.beginSetupWithAutoUnlock();
    await service.completeOnboarding({
      profile: {
        displayName: '自动',
        locale: 'zh-CN',
        timezone: 'Asia/Tokyo',
        ageBand: 'adult',
      },
      models: [],
    });
    service.lock();

    const { lastFrame, unmount } = render(<App service={service} />);
    await tick(300);

    expect(lastFrame()).toContain('主页');
    expect(lastFrame()).toContain('自动');

    unmount();
  });

  it('locks and auto-unlocks with Ctrl+A', async () => {
    const service = makeService();
    await service.beginSetupWithAutoUnlock();
    await service.completeOnboarding({
      profile: {
        displayName: '自动',
        locale: 'zh-CN',
        timezone: 'Asia/Tokyo',
        ageBand: 'adult',
      },
      models: [],
    });
    service.lock();

    const { stdin, lastFrame, unmount } = render(<App service={service} />);
    await tick(300);
    expect(lastFrame()).toContain('主页');

    stdin.write('\x0c');
    await tick(300);
    expect(lastFrame()).toContain('已锁定');
    expect(lastFrame()).toContain('Ctrl+A 自动解锁');

    stdin.write('\x01');
    await tick(300);
    expect(lastFrame()).toContain('主页');

    unmount();
  });

  it('unlocks into the home screen with the stored passphrase', async () => {
    const service = makeService();
    await service.beginSetup('test passphrase 123');
    await service.completeOnboarding({
      profile: {
        displayName: '小林',
        locale: 'zh-CN',
        timezone: 'Asia/Tokyo',
        ageBand: 'adult',
      },
      models: [],
    });
    service.lock();

    const { stdin, lastFrame, unmount } = render(<App service={service} />);
    await tick(300);
    expect(lastFrame()).toContain('已锁定');

    stdin.write('test passphrase 123\r');
    await tick(600);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('主页');
    expect(frame).toContain('小林');
    expect(frame).toContain('还没有配置模型');

    unmount();
  });

  it('switches the lock screen to recovery mode with Tab', async () => {
    const service = makeService();
    await service.beginSetup('test passphrase 123');
    service.lock();

    const { stdin, lastFrame, unmount } = render(<App service={service} />);
    await tick(300);
    expect(lastFrame()).toContain('已锁定');
    stdin.write('\t');
    await tick(300);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('用恢复短语恢复');
    expect(frame).toContain('12 个词');

    unmount();
  });
});
