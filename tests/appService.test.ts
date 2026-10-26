import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTEXT_BUDGET_PRESETS,
  DEFAULT_CONTEXT_BUDGET_SETTINGS,
  type ModelProfile,
} from '../src/config/appConfig.js';
import type { AppPaths } from '../src/config/paths.js';
import type { ChatProvider } from '../src/providers/types.js';
import { AppService } from '../src/services/appService.js';
import { LockoutGate } from '../src/services/lockout.js';
import { ScriptedChatProvider } from './helpers/fakeChatProvider.js';

const TEST_KDF = { N: 1024, r: 8, p: 1, dkLen: 32 } as const;
const PASSPHRASE = 'first passphrase 123';
const NEW_PASSPHRASE = 'second passphrase 456';
const RECOVERED_PASSPHRASE = 'recovered passphrase 789';
const API_KEY = 'sk-test-should-never-be-plaintext';

const roots: string[] = [];
const services: AppService[] = [];

function makePaths(): AppPaths {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-service-'));
  roots.push(root);
  return { data: join(root, 'data'), config: join(root, 'config'), log: join(root, 'log') };
}

function makeService(
  paths: AppPaths,
  options: {
    fastLockout?: boolean;
    chatProviderFactory?: (profile: ModelProfile, apiKey?: string) => ChatProvider;
    autoRunPostSession?: boolean;
  } = {},
): AppService {
  const service = new AppService({
    paths,
    kdf: TEST_KDF,
    postSessionRetryDelaysMs: [0, 0, 0],
    ...(options.autoRunPostSession !== undefined
      ? { autoRunPostSession: options.autoRunPostSession }
      : {}),
    ...(options.fastLockout === false ? {} : { lockout: new LockoutGate({ baseMs: 1, maxMs: 1 }) }),
    ...(options.chatProviderFactory !== undefined
      ? { chatProviderFactory: options.chatProviderFactory }
      : {}),
  });
  services.push(service);
  return service;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  for (const service of services.splice(0)) {
    service.shutdown();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('AppService', () => {
  it('walks setup, onboarding, lock and unlock with encrypted secrets', async () => {
    const paths = makePaths();
    const service = makeService(paths);

    expect((await service.inspect()).phase).toBe('setup');

    const { recoveryPhrase } = await service.beginSetup(PASSPHRASE);
    expect(recoveryPhrase.split(' ')).toHaveLength(12);
    expect(statSync(join(paths.config, 'vault.json')).mode & 0o777).toBe(0o600);
    expect((await service.inspect()).onboardingComplete).toBe(false);

    // 中途退出再解锁，应当接着完成设置而不是重设密码。
    service.lock();
    const resumed = await service.unlock(PASSPHRASE);
    expect(resumed.onboardingComplete).toBe(false);

    const config = await service.completeOnboarding({
      profile: {
        displayName: '  小林  ',
        locale: 'zh-CN',
        timezone: 'Asia/Tokyo',
        ageBand: 'adult',
      },
      models: [
        {
          id: 'openai-main',
          label: 'OpenAI',
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1-mini',
        },
      ],
      apiKeys: { 'openai-main': API_KEY },
    });

    expect(config.onboardingCompletedAt).toBeTruthy();
    expect(config.context).toEqual(DEFAULT_CONTEXT_BUDGET_SETTINGS);
    const compact = await service.updateContextBudget({ ...CONTEXT_BUDGET_PRESETS.compact });
    expect(compact.context.historyTokens).toBe(12_000);
    expect(service.getConfig()?.context.summaryTriggerTokens).toBe(6000);
    await service.updateContextBudget({ ...DEFAULT_CONTEXT_BUDGET_SETTINGS });
    const memoryUpdated = await service.updateMemorySettings({
      enabled: false,
      includeSensitive: true,
      embeddingModel: '',
      embeddingBaseUrl: '',
    });
    expect(memoryUpdated.memory).toEqual({
      enabled: false,
      includeSensitive: true,
      embeddingModel: '',
      embeddingBaseUrl: '',
    });
    const embeddingUpdated = await service.updateMemorySettings({
      ...memoryUpdated.memory,
      embeddingModel: 'nomic-embed-text',
      embeddingBaseUrl: 'http://127.0.0.1:11434/v1/',
    });
    expect(embeddingUpdated.memory.embeddingModel).toBe('nomic-embed-text');
    expect(embeddingUpdated.memory.embeddingBaseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(config.profile.displayName).toBe('小林');
    expect(config.models.activeProfileId).toBe('openai-main');
    expect(service.readProfile()?.timezone).toBe('Asia/Tokyo');
    expect(service.getApiKey('openai-main')).toBe(API_KEY);

    const configText = readFileSync(join(paths.config, 'config.toml'), 'utf8');
    const secretsText = readFileSync(join(paths.config, 'secrets.enc'), 'utf8');
    expect(configText).not.toContain(API_KEY);
    expect(secretsText).not.toContain(API_KEY);
    expect(statSync(join(paths.config, 'config.toml')).mode & 0o777).toBe(0o600);
    expect(statSync(join(paths.config, 'secrets.enc')).mode & 0o777).toBe(0o600);

    service.lock();
    expect(service.snapshot().phase).toBe('locked');
    expect(service.getApiKey('openai-main')).toBeUndefined();
    expect(service.readProfile()).toBeNull();

    const unlocked = await service.unlock(PASSPHRASE);
    expect(unlocked.phase).toBe('unlocked');
    expect(unlocked.onboardingComplete).toBe(true);
    expect(service.readProfile()?.displayName).toBe('小林');
    expect(service.getApiKey('openai-main')).toBe(API_KEY);

    await service.updateLockTimeout(30);
    expect(service.getConfig()?.lock.timeoutMinutes).toBe(30);
    expect(readFileSync(join(paths.config, 'config.toml'), 'utf8')).toContain(
      'timeoutMinutes = 30',
    );

    await service.changePassphrase(PASSPHRASE, NEW_PASSPHRASE);
    service.lock();

    await expect(service.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
    await sleep(10);
    const afterChange = await service.unlock(NEW_PASSPHRASE);
    expect(afterChange.onboardingComplete).toBe(true);
    expect(service.readProfile()?.displayName).toBe('小林');

    service.shutdown();
  });

  it('recovers a vault with the recovery phrase and keeps the data', async () => {
    const paths = makePaths();
    const service = makeService(paths);
    const { recoveryPhrase } = await service.beginSetup(PASSPHRASE);
    await service.completeOnboarding({
      profile: {
        displayName: '阿青',
        locale: 'zh-CN',
        timezone: 'UTC',
        ageBand: 'unspecified',
      },
      models: [],
    });
    service.shutdown();

    const recovering = makeService(paths);
    await expect(
      recovering.recoverWithPhrase('not a valid phrase', NEW_PASSPHRASE),
    ).rejects.toMatchObject({ code: 'INVALID_RECOVERY_PHRASE' });
    await sleep(10);

    const recovered = await recovering.recoverWithPhrase(recoveryPhrase, RECOVERED_PASSPHRASE);
    expect(recovered.phase).toBe('unlocked');
    expect(recovered.onboardingComplete).toBe(true);
    expect(recovering.readProfile()?.displayName).toBe('阿青');

    recovering.lock();
    await expect(recovering.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
    await sleep(10);
    expect((await recovering.unlock(RECOVERED_PASSPHRASE)).phase).toBe('unlocked');

    // 恢复短语在改密后仍应有效。
    recovering.lock();
    await sleep(10);
    const secondRecovery = await recovering.recoverWithPhrase(
      recoveryPhrase,
      'third passphrase 000',
    );
    expect(secondRecovery.phase).toBe('unlocked');
    expect(recovering.readProfile()?.displayName).toBe('阿青');
  });

  it('throttles repeated wrong passphrases', async () => {
    const paths = makePaths();
    const setup = makeService(paths);
    await setup.beginSetup(PASSPHRASE);
    setup.shutdown();

    const service = makeService(paths, { fastLockout: false });
    await expect(service.unlock('wrong passphrase')).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
    await expect(service.unlock('wrong passphrase')).rejects.toMatchObject({
      code: 'LOCKED_OUT',
    });
  });

  it('persists a chat session through the service and survives lock and unlock', async () => {
    const paths = makePaths();
    const provider = new ScriptedChatProvider([
      [
        { type: 'delta', text: '你好' },
        { type: 'done', finishReason: 'stop' },
      ],
      [{ type: 'delta', text: '主题：疲惫\n情绪：低落' }, { type: 'done' }],
      [{ type: 'delta', text: '纵向理解：长期疲惫与边界有关。' }, { type: 'done' }],
      [{ type: 'delta', text: '督导：先减慢节奏。' }, { type: 'done' }],
      [
        {
          type: 'delta',
          text: '主题：疲惫\n重要背景：最近很累。\n偏好与资源：愿意休息。\n未完成：没有安排休息。\n下次可以：谈休息边界。',
        },
        { type: 'done' },
      ],
      [{ type: 'delta', text: '小林，今天辛苦了。' }, { type: 'done' }],
      [{ type: 'delta', text: '[]' }, { type: 'done' }],
    ]);
    const service = makeService(paths, { chatProviderFactory: () => provider });
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
    expect(session.status).toBe('draft');
    const chat = service.createChat(session.id);
    const result = await chat.send(session.id, '今天有点累');
    expect(result.status).toBe('done');
    const systemPrompt = provider.requests[0]?.messages[0]?.content ?? '';
    expect(systemPrompt).toContain('知微');
    expect(systemPrompt).toContain('本轮伦理要求');
    expect(systemPrompt).toContain('本轮安全要求');
    expect(service.listSessionMessages(session.id)).toHaveLength(3);
    expect(service.listContextAudits(session.id)).toHaveLength(1);
    expect(service.getSession(session.id)?.title).toBe('今天有点累');
    expect(service.getSessionUsage(session.id).completionTokens).toBeGreaterThan(0);

    const ended = service.endSession(session.id);
    expect(ended.session?.status).toBe('ended');
    expect(service.getLastEndedSession()?.id).toBe(session.id);
    expect(service.listPostSessionJobs(session.id).map((job) => job.kind)).toEqual([
      'session_note',
      'case_formulation',
      'supervision',
      'memo',
      'letter',
      'memory',
    ]);
    const firstRun = service.runPostSession(session.id);
    const secondRun = service.runPostSession(session.id);
    expect(firstRun).toBe(secondRun);
    const postSession = await firstRun;
    expect(postSession.jobs.every((job) => job.status === 'ready')).toBe(true);

    const exportPath = await service.exportSession(session.id, PASSPHRASE);
    expect(statSync(exportPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(exportPath, 'utf8')).toContain('今天有点累');

    const allPath = await service.exportAllData(PASSPHRASE);
    expect(statSync(allPath).mode & 0o777).toBe(0o600);
    const allData = JSON.parse(readFileSync(allPath, 'utf8')) as {
      sessions: Array<{ session: { id: string } }>;
      memories: unknown[];
    };
    expect(allData.sessions[0]?.session.id).toBe(session.id);
    expect(Array.isArray(allData.memories)).toBe(true);
    expect(readFileSync(allPath, 'utf8')).not.toContain('sk-');
    expect(readFileSync(allPath, 'utf8')).not.toContain('apiKey');

    service.lock();
    await service.unlock(PASSPHRASE);
    expect(service.getSession(session.id)?.status).toBe('ended');
    expect(service.listSessionMessages(session.id)).toHaveLength(3);

    const resumed = service.continueLastSession();
    expect(resumed.id).toBe(session.id);
    expect(resumed.status).toBe('active');

    await expect(service.exportSession(session.id, 'wrong passphrase')).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
  });

  it('refuses to create a chat when no model is configured', async () => {
    const paths = makePaths();
    const service = makeService(paths);
    await service.beginSetup(PASSPHRASE);
    await service.completeOnboarding({
      profile: {
        displayName: '',
        locale: 'zh-CN',
        timezone: 'UTC',
        ageBand: 'unspecified',
      },
      models: [],
    });
    const session = service.createSession();
    expect(() => service.createChat(session.id)).toThrow(
      expect.objectContaining({ code: 'NO_MODEL' }),
    );
  });

  it('creates a manual encrypted backup with vault and config but no secrets file', async () => {
    const service = makeService(makePaths());
    await service.beginSetup(PASSPHRASE);
    await service.completeOnboarding({
      profile: {
        displayName: '小林',
        locale: 'zh-CN',
        timezone: 'Asia/Tokyo',
        ageBand: 'adult',
      },
      models: [],
    });

    const dir = await service.createBackup(PASSPHRASE);
    const files = readdirSync(dir);
    expect(files.some((file) => file.endsWith('.db'))).toBe(true);
    expect(files).toContain('vault.json');
    expect(files).toContain('config.toml');
    expect(files).toContain('RESTORE.txt');
    expect(files).not.toContain('secrets.enc');
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const file of files) {
      expect(statSync(join(dir, file)).mode & 0o077).toBe(0);
    }
    const listed = service.listManualBackups();
    expect(listed.map((backup) => backup.path)).toContain(dir);
    expect(service.readBackupRestore(dir)).toContain('恢复步骤');
    expect(() => service.readBackupRestore(service.appPaths.config)).toThrow(/备份路径无效/);

    await expect(service.createBackup('wrong backup passphrase')).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
  });

  it('resumes queued post-session jobs after unlock', async () => {
    const paths = makePaths();
    const chatProvider = new ScriptedChatProvider([
      [{ type: 'delta', text: '你好' }, { type: 'done' }],
    ]);
    const first = makeService(paths, {
      chatProviderFactory: () => chatProvider,
      autoRunPostSession: false,
    });
    await first.beginSetup(PASSPHRASE);
    await first.completeOnboarding({
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
    const session = first.createSession();
    const chat = first.createChat(session.id);
    await chat.send(session.id, '今天有点累');
    first.endSession(session.id);
    expect(first.listPostSessionJobs(session.id).every((job) => job.status === 'queued')).toBe(
      true,
    );
    first.shutdown();
    await sleep(50);

    const resumeProvider = new ScriptedChatProvider([
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
      [{ type: 'delta', text: '小林，辛苦了。' }, { type: 'done' }],
      [{ type: 'delta', text: '[]' }, { type: 'done' }],
    ]);
    const second = makeService(paths, {
      chatProviderFactory: () => resumeProvider,
      autoRunPostSession: true,
    });
    await second.unlock(PASSPHRASE);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const jobs = second.listPostSessionJobs(session.id);
      if (jobs.length > 0 && jobs.every((job) => job.status === 'ready')) {
        break;
      }
      await sleep(25);
    }
    expect(second.listPostSessionJobs(session.id).every((job) => job.status === 'ready')).toBe(
      true,
    );
  });

  it('restores a backup after verifying its passphrase and protects current data first', async () => {
    const paths = makePaths();
    const provider = new ScriptedChatProvider([
      [{ type: 'delta', text: '我在听。' }, { type: 'done' }],
      [{ type: 'delta', text: '我在听。' }, { type: 'done' }],
    ]);
    const service = makeService(paths, {
      chatProviderFactory: () => provider,
      autoRunPostSession: false,
    });
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
    const first = service.createSession();
    const firstChat = service.createChat(first.id);
    await firstChat.send(first.id, '第一场');
    service.endSession(first.id);
    const backup = await service.createBackup(PASSPHRASE);
    const second = service.createSession();
    const secondChat = service.createChat(second.id);
    await secondChat.send(second.id, '第二场');
    service.endSession(second.id);

    await expect(service.restoreBackup(backup, 'wrong restore passphrase')).rejects.toMatchObject({
      code: 'WRONG_PASSPHRASE',
    });
    expect(service.listSessions().map((session) => session.id)).toContain(second.id);

    const safety = await service.restoreBackup(backup, PASSPHRASE);
    expect(existsSync(safety)).toBe(true);
    expect(() => service.listSessions()).toThrow(/尚未解锁/);
    await service.unlock(PASSPHRASE);
    const restoredIds = service.listSessions().map((session) => session.id);
    expect(restoredIds).toContain(first.id);
    expect(restoredIds).not.toContain(second.id);
  });

  it('wipes the database, vault, config and logs after passphrase verification', async () => {
    const paths = makePaths();
    const service = makeService(paths);
    await service.beginSetup(PASSPHRASE);
    await service.completeOnboarding({
      profile: {
        displayName: '小林',
        locale: 'zh-CN',
        timezone: 'Asia/Tokyo',
        ageBand: 'adult',
      },
      models: [],
    });
    service.createSession();
    await service.wipeAllData(PASSPHRASE);
    expect(existsSync(paths.data)).toBe(false);
    expect(existsSync(paths.config)).toBe(false);
    expect(existsSync(paths.log)).toBe(false);
    await expect(service.unlock(PASSPHRASE)).rejects.toMatchObject({ code: 'NOT_SETUP' });
  });
});
