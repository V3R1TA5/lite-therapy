import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  type AppConfig,
  type ContextBudgetSettings,
  createInitialConfig,
  DEFAULT_CONTEXT_BUDGET_SETTINGS,
  DEFAULT_MEMORY_SETTINGS,
  type LockTimeout,
  loadAppConfig,
  type MemorySettings,
  type ModelProfile,
  type ProfileSettings,
  parseAppConfig,
  resolveTimezone,
  saveAppConfig,
  systemTimezone,
  type ThemeMode,
} from '../config/appConfig.js';
import { writeFileAtomic } from '../config/atomicFile.js';
import type { AppPaths } from '../config/paths.js';
import { getAppPaths } from '../config/paths.js';
import { ModelRiskClassifier } from '../core/safety/classifier.js';
import { AI_DISCLOSURE, APP_NAME, APP_VERSION, DISCLAIMER } from '../core/version.js';
import { backupDatabase } from '../db/backup.js';
import { type DatabaseConnection, openEncryptedDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrations/index.js';
import {
  type ContextAuditRecord,
  listContextAudits,
} from '../db/repositories/contextAuditRepository.js';
import {
  archiveMemoryCard,
  clearMemoryCards,
  confirmMemoryCard,
  countMemoriesForSession,
  deleteMemoriesForSession,
  deleteMemoryCard,
  deleteMemoryCards,
  getMemoryCard,
  listMemoryCards,
  listMemoryCardsForSession,
  listMemoryRevisions,
  listRecallsForMemory,
  type MemoryKind,
  updateMemoryCardText,
} from '../db/repositories/memoryRepository.js';
import {
  getMessage,
  type MessageRecord,
  recoverStreamingMessages,
} from '../db/repositories/messageRepository.js';
import { sumUsageForSession } from '../db/repositories/modelUsageRepository.js';
import {
  archiveReadyMemosForSession,
  countUnreadLetters,
  getLatestCaseFormulation,
  getLatestLetterForSession,
  getLatestReadyMemo as getLatestReadyMemoRow,
  getLatestSessionNote,
  getLatestSupervision,
  getReadyMemoById,
  getReadyMemoForSession,
  type LetterRecord,
  listLetters,
  listPostSessionJobs as listPostSessionJobsRow,
  listSessionsWithQueuedJobs,
  markLetterRead,
  markSessionJobsStale,
  resetRunningPostSessionJobs,
} from '../db/repositories/postSessionRepository.js';
import {
  getProfile,
  type ProfileRecord,
  saveProfile,
} from '../db/repositories/profileRepository.js';
import type { SessionRecord } from '../db/repositories/sessionRepository.js';
import { type ConnectionTestResult, testModelConnection } from '../providers/connectionTest.js';
import { OpenAICompatibleProvider } from '../providers/openaiCompatible.js';
import type { ChatProvider } from '../providers/types.js';
import { type ApiKeyMap, loadSecretsFile, saveSecretsFile } from '../security/secrets.js';
import {
  createVault,
  type KdfParams,
  recoverVault,
  replacePassphrase,
  unlockVault,
  wipe,
} from '../security/vault.js';
import { loadVaultFile, saveVaultFile, vaultExists } from '../security/vaultStore.js';
import { ChatService } from './chatService.js';
import {
  type CrisisResources,
  EMPTY_CRISIS_RESOURCES,
  loadCrisisResources,
} from './crisisResources.js';
import { type ExportOptions, exportSessionToFile } from './exportService.js';
import { LockoutGate } from './lockout.js';
import { MemoryService, memoryTextHash } from './memoryService.js';
import { buildMemoSnapshot, type MemoSnapshot } from './memoSnapshot.js';
import { PostSessionService, type RunPostSessionResult } from './postSessionService.js';
import { type SafetyEvaluator, SafetyService } from './safetyService.js';
import { SessionService } from './sessionService.js';
import { validateNewPassphrase } from './setupPolicy.js';

export type AppPhase = 'setup' | 'locked' | 'unlocked';

export interface AppSnapshot {
  phase: AppPhase;
  hasVault: boolean;
  onboardingComplete: boolean;
  config: AppConfig | null;
}

export interface OnboardingInput {
  profile: ProfileSettings;
  models: ModelProfile[];
  apiKeys?: ApiKeyMap;
}

export type AppServiceErrorCode =
  | 'ALREADY_SETUP'
  | 'NOT_SETUP'
  | 'NOT_UNLOCKED'
  | 'LOCKED_OUT'
  | 'WRONG_PASSPHRASE'
  | 'INVALID_RECOVERY_PHRASE'
  | 'INVALID_PASSPHRASE'
  | 'INVALID_INPUT'
  | 'NO_MODEL';

export class AppServiceError extends Error {
  readonly code: AppServiceErrorCode;
  readonly retryAfterMs?: number;

  constructor(
    code: AppServiceErrorCode,
    message: string,
    options: ErrorOptions & { retryAfterMs?: number } = {},
  ) {
    super(message, options);
    this.name = 'AppServiceError';
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export interface ManualBackupSummary {
  name: string;
  path: string;
  createdAt: string;
}

export interface AppServiceOptions {
  paths?: AppPaths;
  /** 仅供测试加速；生产使用 vault 默认参数。 */
  kdf?: KdfParams;
  now?: () => Date;
  lockout?: LockoutGate;
  fetchImpl?: typeof fetch;
  chatProviderFactory?: (profile: ModelProfile, apiKey?: string) => ChatProvider;
  postSessionRetryDelaysMs?: number[];
  autoRunPostSession?: boolean;
  safetyEvaluatorFactory?: (sessionId: string) => SafetyEvaluator | undefined;
}

export class AppService {
  private readonly paths: AppPaths;
  private readonly kdf?: KdfParams;
  private readonly now: () => Date;
  private readonly lockout: LockoutGate;
  private readonly fetchImpl?: typeof fetch;
  private readonly chatProviderFactory?: (profile: ModelProfile, apiKey?: string) => ChatProvider;
  private readonly postSessionRetryDelaysMs?: number[];
  private readonly autoRunPostSession: boolean;
  private readonly safetyEvaluatorFactory?: (sessionId: string) => SafetyEvaluator | undefined;

  private db: DatabaseConnection | null = null;
  private dbKey: Buffer | null = null;
  private config: AppConfig | null = null;
  private apiKeys: ApiKeyMap = {};
  private sessions: SessionService | null = null;
  private activeChat: ChatService | null = null;
  private readonly postSessionRuns = new Map<string, Promise<RunPostSessionResult>>();

  constructor(options: AppServiceOptions = {}) {
    this.paths = options.paths ?? getAppPaths();
    this.kdf = options.kdf;
    this.now = options.now ?? (() => new Date());
    this.lockout = options.lockout ?? new LockoutGate();
    this.fetchImpl = options.fetchImpl;
    this.chatProviderFactory = options.chatProviderFactory;
    this.postSessionRetryDelaysMs = options.postSessionRetryDelaysMs;
    this.autoRunPostSession = options.autoRunPostSession ?? true;
    this.safetyEvaluatorFactory = options.safetyEvaluatorFactory;
  }

  get appPaths(): AppPaths {
    return this.paths;
  }

  private get vaultPath(): string {
    return join(this.paths.config, 'vault.json');
  }

  private get configPath(): string {
    return join(this.paths.config, 'config.toml');
  }

  private get secretsPath(): string {
    return join(this.paths.config, 'secrets.enc');
  }

  private get databasePath(): string {
    return join(this.paths.data, 'counsel.db');
  }

  private get backupDir(): string {
    return join(this.paths.data, 'backups');
  }

  async inspect(): Promise<AppSnapshot> {
    const hasVault = vaultExists(this.vaultPath);
    const config = this.config ?? loadAppConfig(this.configPath);
    const phase: AppPhase = this.dbKey ? 'unlocked' : hasVault ? 'locked' : 'setup';
    return {
      phase,
      hasVault,
      onboardingComplete: Boolean(config?.onboardingCompletedAt),
      config,
    };
  }

  /**
   * 首次设置。调用方应先在界面上展示并让用户确认恢复短语，
   * 再把同一个短语传进来；这样中途退出不会留下“短语从未抄下”的保险库。
   */
  async beginSetup(
    passphrase: string,
    recoveryPhrase?: string,
  ): Promise<{ recoveryPhrase: string; config: AppConfig }> {
    if (vaultExists(this.vaultPath)) {
      throw new AppServiceError('ALREADY_SETUP', '保险库已经存在，请直接解锁。');
    }
    const passphraseIssue = validateNewPassphrase(passphrase);
    if (passphraseIssue !== null) {
      throw new AppServiceError('INVALID_PASSPHRASE', passphraseIssue);
    }

    const config = createInitialConfig(this.now(), systemTimezone());
    saveAppConfig(this.configPath, config);

    const created = await createVault(passphrase, {
      ...(this.kdf ? { kdf: this.kdf } : {}),
      ...(recoveryPhrase ? { mnemonic: recoveryPhrase } : {}),
    });
    saveVaultFile(this.vaultPath, created.vault);

    try {
      await this.openDatabase(created.dbKey);
    } catch (error) {
      wipe(created.dbKey);
      throw error;
    }

    this.dbKey = created.dbKey;
    this.config = config;
    this.apiKeys = {};
    return { recoveryPhrase: created.recoveryPhrase, config };
  }

  async unlock(passphrase: string): Promise<AppSnapshot> {
    if (!vaultExists(this.vaultPath)) {
      throw new AppServiceError('NOT_SETUP', '还没有创建保险库，请先完成首次设置。');
    }
    this.assertNotThrottled();

    const vault = loadVaultFile(this.vaultPath);
    let key: Buffer;
    try {
      key = await unlockVault(vault, passphrase);
    } catch (error) {
      const delay = this.lockout.recordFailure();
      throw new AppServiceError('WRONG_PASSPHRASE', '启动密码不正确。', {
        cause: error,
        retryAfterMs: delay,
      });
    }

    let config: AppConfig;
    let apiKeys: ApiKeyMap;
    try {
      await this.openDatabase(key);
      config = this.loadOrCreateConfig(vault.createdAt);
      apiKeys = loadSecretsFile(this.secretsPath, key);
    } catch (error) {
      this.closeDatabase();
      wipe(key);
      throw error;
    }

    if (this.dbKey) {
      wipe(this.dbKey);
    }
    this.dbKey = key;
    this.config = config;
    this.apiKeys = apiKeys;
    this.lockout.reset();
    this.resumeQueuedPostSessions();
    return this.snapshot();
  }

  async recoverWithPhrase(phrase: string, newPassphrase: string): Promise<AppSnapshot> {
    if (!vaultExists(this.vaultPath)) {
      throw new AppServiceError('NOT_SETUP', '没有可恢复的保险库。');
    }
    const passphraseIssue = validateNewPassphrase(newPassphrase);
    if (passphraseIssue !== null) {
      throw new AppServiceError('INVALID_PASSPHRASE', passphraseIssue);
    }
    this.assertNotThrottled();

    const vault = loadVaultFile(this.vaultPath);
    let key: Buffer;
    try {
      key = await recoverVault(vault, phrase);
    } catch (error) {
      const delay = this.lockout.recordFailure();
      throw new AppServiceError('INVALID_RECOVERY_PHRASE', '恢复短语不正确。', {
        cause: error,
        retryAfterMs: delay,
      });
    }

    let config: AppConfig;
    let apiKeys: ApiKeyMap;
    try {
      const updated = await replacePassphrase(vault, key, newPassphrase);
      saveVaultFile(this.vaultPath, updated);
      await this.openDatabase(key);
      config = this.loadOrCreateConfig(vault.createdAt);
      apiKeys = loadSecretsFile(this.secretsPath, key);
    } catch (error) {
      this.closeDatabase();
      wipe(key);
      throw error;
    }

    if (this.dbKey) {
      wipe(this.dbKey);
    }
    this.dbKey = key;
    this.config = config;
    this.apiKeys = apiKeys;
    this.lockout.reset();
    this.resumeQueuedPostSessions();
    return this.snapshot();
  }

  async verifyPassphrase(passphrase: string): Promise<void> {
    this.requireUnlocked();
    this.assertNotThrottled();
    const vault = loadVaultFile(this.vaultPath);
    let key: Buffer;
    try {
      key = await unlockVault(vault, passphrase);
    } catch (error) {
      const delay = this.lockout.recordFailure();
      throw new AppServiceError('WRONG_PASSPHRASE', '启动密码不正确。', {
        cause: error,
        retryAfterMs: delay,
      });
    }
    try {
      if (this.dbKey === null || !key.equals(this.dbKey)) {
        throw new AppServiceError('WRONG_PASSPHRASE', '启动密码不正确。');
      }
    } finally {
      wipe(key);
    }
    this.lockout.reset();
  }

  async createBackup(passphrase: string): Promise<string> {
    this.requireUnlocked();
    await this.verifyPassphrase(passphrase);
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const dir = join(this.paths.data, 'manual-backups', 'backup-' + stamp);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    await backupDatabase(this.db, dir, { prefix: 'counsel', now: this.now() });
    copyFileSync(this.vaultPath, join(dir, 'vault.json'));
    copyFileSync(this.configPath, join(dir, 'config.toml'));
    chmodSync(join(dir, 'vault.json'), 0o600);
    chmodSync(join(dir, 'config.toml'), 0o600);
    writeFileSync(
      join(dir, 'RESTORE.txt'),
      [
        'Lite Therapy 手动备份',
        '',
        '包含：加密数据库快照、vault.json、config.toml。',
        '不包含：API Key（secrets.enc）、导出文件、终端回滚。',
        '',
        '恢复步骤：',
        '1. 完全退出 Lite Therapy。',
        '2. 把 counsel-*.db 复制为数据目录的 counsel.db；把 vault.json 与 config.toml 复制回配置目录。',
        '3. 启动应用，用原启动密码或恢复短语解锁。',
        '4. 如果 API Key 丢失，需要在模型设置中重新填写。',
        '',
        '请在恢复前另行备份当前数据；覆盖后无法从应用内撤销。',
      ].join('\n'),
      { mode: 0o600 },
    );
    return dir;
  }

  listManualBackups(): ManualBackupSummary[] {
    this.requireUnlocked();
    const root = join(this.paths.data, 'manual-backups');
    if (!existsSync(root)) {
      return [];
    }
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const path = join(root, entry.name);
        return {
          name: entry.name,
          path,
          createdAt: statSync(path).mtime.toISOString(),
        };
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  readBackupRestore(backupPath: string): string {
    this.requireUnlocked();
    const root = resolve(this.paths.data, 'manual-backups');
    const target = resolve(backupPath);
    if (!target.startsWith(root + sep)) {
      throw new AppServiceError('INVALID_INPUT', '备份路径无效。');
    }
    const restorePath = join(target, 'RESTORE.txt');
    if (!existsSync(restorePath)) {
      throw new AppServiceError('INVALID_INPUT', '这个备份缺少恢复说明。');
    }
    return readFileSync(restorePath, 'utf8');
  }

  async exportAllData(passphrase: string): Promise<string> {
    this.requireUnlocked();
    await this.verifyPassphrase(passphrase);
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    const db = this.db;
    const sessions = this.requireSessions().listSessions(1000);
    const letters = listLetters(db, 1000);
    const memories = listMemoryCards(db, { limit: 1000 }).map((card) => ({
      ...card,
      embedding: undefined,
      revisions: listMemoryRevisions(db, card.id, 100),
    }));
    const data = {
      app: APP_NAME,
      version: APP_VERSION,
      exportedAt: this.now().toISOString(),
      disclaimer: DISCLAIMER,
      aiDisclosure: AI_DISCLOSURE,
      config: this.config,
      latestCaseFormulation: getLatestCaseFormulation(db, 'zhiwei'),
      sessions: sessions.map((session) => ({
        session,
        messages: this.requireSessions().listMessages(session.id),
        jobs: listPostSessionJobsRow(db, session.id),
        note: getLatestSessionNote(db, session.id),
        supervision: getLatestSupervision(db, session.id),
        memo: this.requireSessions().getMemoSnapshot(session.id),
      })),
      letters,
      memories,
    };
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const path = join(this.paths.data, 'exports', 'lite-therapy-all-' + stamp + '.json');
    writeFileAtomic(path, JSON.stringify(data, null, 2), 0o600);
    return path;
  }

  async restoreBackup(backupPath: string, passphrase: string): Promise<string> {
    this.requireUnlocked();
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    const root = resolve(this.paths.data, 'manual-backups');
    const target = resolve(backupPath);
    if (!target.startsWith(root + sep)) {
      throw new AppServiceError('INVALID_INPUT', '备份路径无效。');
    }
    const files = readdirSync(target);
    const dbName = files.find((file) => file.endsWith('.db'));
    if (dbName === undefined || !files.includes('vault.json') || !files.includes('config.toml')) {
      throw new AppServiceError('INVALID_INPUT', '这个备份不完整。');
    }

    const backupVault = loadVaultFile(join(target, 'vault.json'));
    let backupKey: Buffer | null = null;
    try {
      backupKey = await unlockVault(backupVault, passphrase);
    } catch {
      throw new AppServiceError('WRONG_PASSPHRASE', '备份的启动密码不正确。');
    } finally {
      if (backupKey !== null) {
        wipe(backupKey);
      }
    }

    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const safetyDir = join(this.paths.data, 'manual-backups', 'pre-restore-' + stamp);
    mkdirSync(safetyDir, { recursive: true, mode: 0o700 });
    chmodSync(safetyDir, 0o700);
    await backupDatabase(this.db, safetyDir, { prefix: 'counsel', now: this.now() });
    copyFileSync(this.vaultPath, join(safetyDir, 'vault.json'));
    copyFileSync(this.configPath, join(safetyDir, 'config.toml'));
    chmodSync(join(safetyDir, 'vault.json'), 0o600);
    chmodSync(join(safetyDir, 'config.toml'), 0o600);

    this.lock();
    const replaceFile = (source: string, destination: string) => {
      const temporary = destination + '.restore-tmp';
      copyFileSync(source, temporary);
      chmodSync(temporary, 0o600);
      renameSync(temporary, destination);
    };
    replaceFile(join(target, dbName), this.databasePath);
    replaceFile(join(target, 'vault.json'), this.vaultPath);
    replaceFile(join(target, 'config.toml'), this.configPath);
    rmSync(this.databasePath + '-wal', { force: true });
    rmSync(this.databasePath + '-shm', { force: true });
    const secretsPath = join(this.paths.config, 'secrets.enc');
    if (existsSync(secretsPath)) {
      renameSync(secretsPath, secretsPath + '.restored-away-' + stamp);
    }
    return safetyDir;
  }

  async wipeAllData(passphrase: string): Promise<void> {
    this.requireUnlocked();
    await this.verifyPassphrase(passphrase);
    const dirs = [this.paths.data, this.paths.config, this.paths.log];
    for (const dir of dirs) {
      const resolved = resolve(dir);
      if (resolved === '/' || resolved.length < 4) {
        throw new AppServiceError('INVALID_INPUT', '拒绝删除不安全的路径。');
      }
    }
    this.lock();
    for (const dir of dirs) {
      rmSync(resolve(dir), { recursive: true, force: true });
    }
  }

  async exportSession(
    sessionId: string,
    passphrase: string,
    options: ExportOptions = {},
  ): Promise<string> {
    this.requireUnlocked();
    await this.verifyPassphrase(passphrase);
    const session = this.requireSessions().getSession(sessionId);
    if (session === null) {
      throw new AppServiceError('INVALID_INPUT', '会谈不存在。');
    }
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    const db = this.db;
    const messages = this.requireSessions().listMessages(sessionId);
    const artifacts = {
      ...(options.includeLetter !== false
        ? { letter: getLatestLetterForSession(db, sessionId) }
        : {}),
      ...(options.includeMemo === true ? { memo: getReadyMemoForSession(db, sessionId) } : {}),
      ...(options.includeMemory === true
        ? { memories: listMemoryCardsForSession(db, sessionId) }
        : {}),
      ...(options.includeInternal === true
        ? {
            note: getLatestSessionNote(db, sessionId),
            formulation: getLatestCaseFormulation(db, 'zhiwei'),
            supervision: getLatestSupervision(db, sessionId),
          }
        : {}),
    };
    return exportSessionToFile({
      session,
      messages,
      timezone: this.config?.profile.timezone ?? 'UTC',
      exportDir: join(this.paths.data, 'exports'),
      options,
      artifacts,
      now: this.now(),
    });
  }

  async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<void> {
    this.requireUnlocked();
    const passphraseIssue = validateNewPassphrase(newPassphrase);
    if (passphraseIssue !== null) {
      throw new AppServiceError('INVALID_PASSPHRASE', passphraseIssue);
    }

    const vault = loadVaultFile(this.vaultPath);
    let verified: Buffer;
    try {
      verified = await unlockVault(vault, oldPassphrase);
    } catch (error) {
      throw new AppServiceError('WRONG_PASSPHRASE', '当前启动密码不正确。', { cause: error });
    }

    try {
      if (this.dbKey === null || !verified.equals(this.dbKey)) {
        throw new AppServiceError('WRONG_PASSPHRASE', '当前启动密码不正确。');
      }
      const updated = await replacePassphrase(vault, this.dbKey, newPassphrase);
      saveVaultFile(this.vaultPath, updated);
    } finally {
      wipe(verified);
    }
  }

  async completeOnboarding(input: OnboardingInput): Promise<AppConfig> {
    this.requireUnlocked();
    const base = this.config ?? createInitialConfig(this.now(), systemTimezone());

    const profiles = input.models.map((profile) => ({ ...profile }));
    const next = parseAppConfig({
      ...base,
      onboardingCompletedAt: this.now().toISOString(),
      profile: {
        ...input.profile,
        displayName: input.profile.displayName.trim(),
        timezone: resolveTimezone(input.profile.timezone),
      },
      models: {
        profiles,
        ...(profiles[0] ? { activeProfileId: profiles[0].id } : {}),
      },
    });

    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开，无法保存档案。');
    }

    saveProfile(this.db, next.profile, this.now());
    this.applyApiKeys(next, input.apiKeys);
    saveAppConfig(this.configPath, next);
    this.config = next;
    return next;
  }

  async updateModelConfig(models: ModelProfile[], apiKeys?: ApiKeyMap): Promise<AppConfig> {
    this.requireUnlocked();
    const base = this.config;
    if (base === null) {
      throw new AppServiceError('NOT_UNLOCKED', '配置尚未加载。');
    }
    const profiles = models.map((profile) => ({ ...profile }));
    const next = parseAppConfig({
      ...base,
      models: {
        profiles,
        ...(profiles[0] ? { activeProfileId: profiles[0].id } : {}),
      },
    });
    this.applyApiKeys(next, apiKeys);
    saveAppConfig(this.configPath, next);
    this.config = next;
    return next;
  }

  async updateTheme(theme: ThemeMode): Promise<AppConfig> {
    this.requireUnlocked();
    const base = this.config;
    if (base === null) {
      throw new AppServiceError('NOT_UNLOCKED', '配置尚未加载。');
    }
    const next = parseAppConfig({ ...base, theme });
    saveAppConfig(this.configPath, next);
    this.config = next;
    return next;
  }

  async updateLockTimeout(timeoutMinutes: LockTimeout): Promise<AppConfig> {
    this.requireUnlocked();
    const base = this.config;
    if (base === null) {
      throw new AppServiceError('NOT_UNLOCKED', '配置尚未加载。');
    }
    const next = parseAppConfig({ ...base, lock: { timeoutMinutes } });
    saveAppConfig(this.configPath, next);
    this.config = next;
    return next;
  }

  private createPostSessionService(): PostSessionService | null {
    if (this.db === null || this.sessions === null) {
      return null;
    }
    const profile = this.getActiveModelProfile();
    if (profile === null) {
      return null;
    }
    const apiKey = this.apiKeys[profile.id];
    const provider = this.chatProviderFactory
      ? this.chatProviderFactory(profile, apiKey)
      : new OpenAICompatibleProvider();
    return new PostSessionService({
      db: this.db,
      sessions: this.sessions,
      provider,
      profile,
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(this.config?.profile.displayName ? { displayName: this.config.profile.displayName } : {}),
      ...(this.config?.memory.embeddingModel
        ? { embeddingModel: this.config.memory.embeddingModel }
        : {}),
      now: this.now,
      ...(this.postSessionRetryDelaysMs !== undefined
        ? { retryDelaysMs: this.postSessionRetryDelaysMs }
        : {}),
    });
  }

  private resumeQueuedPostSessions(): void {
    if (!this.autoRunPostSession || this.db === null) {
      return;
    }
    for (const { sessionId } of listSessionsWithQueuedJobs(this.db)) {
      if (this.postSessionRuns.has(sessionId)) {
        continue;
      }
      try {
        void this.runPostSession(sessionId).catch(() => {
          // 续跑失败保留 failed 任务，由进度页手动重试。
        });
      } catch {
        // 没有模型或配置异常时保持 queued，等待用户回到进度页。
      }
    }
  }

  runPostSession(sessionId: string): ReturnType<PostSessionService['run']> {
    const existing = this.postSessionRuns.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const service = this.createPostSessionService();
    if (service === null) {
      throw new AppServiceError('NO_MODEL', '还没有配置模型，暂时不能整理会谈。');
    }
    const run = service.run(sessionId).finally(() => {
      this.postSessionRuns.delete(sessionId);
    });
    this.postSessionRuns.set(sessionId, run);
    return run;
  }

  retryPostSession(sessionId: string): ReturnType<PostSessionService['retryFailed']> {
    const existing = this.postSessionRuns.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const service = this.createPostSessionService();
    if (service === null) {
      throw new AppServiceError('NO_MODEL', '还没有配置模型，暂时不能整理会谈。');
    }
    const run = service.retryFailed(sessionId).finally(() => {
      this.postSessionRuns.delete(sessionId);
    });
    this.postSessionRuns.set(sessionId, run);
    return run;
  }

  listPostSessionJobs(sessionId: string) {
    this.requireUnlocked();
    if (this.db === null) {
      return [];
    }
    return listPostSessionJobsRow(this.db, sessionId);
  }

  getPostSessionArtifacts(sessionId: string) {
    this.requireUnlocked();
    if (this.db === null) {
      return { note: null, formulation: null, supervision: null, memo: null };
    }
    return {
      note: getLatestSessionNote(this.db, sessionId),
      formulation: getLatestCaseFormulation(this.db, 'zhiwei'),
      supervision: getLatestSupervision(this.db, sessionId),
      memo: getReadyMemoForSession(this.db, sessionId),
    };
  }

  async updateContextBudget(context: ContextBudgetSettings): Promise<AppConfig> {
    this.requireUnlocked();
    const base = this.config;
    if (base === null) {
      throw new AppServiceError('NOT_UNLOCKED', '配置尚未加载。');
    }
    const next = parseAppConfig({
      ...base,
      context: {
        historyTokens: context.historyTokens,
        summaryTriggerTokens: context.summaryTriggerTokens,
        recentTargetTokens: context.recentTargetTokens,
      },
    });
    saveAppConfig(this.configPath, next);
    this.config = next;
    return next;
  }

  listContextAudits(sessionId: string, limit = 20): ContextAuditRecord[] {
    this.requireUnlocked();
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    return listContextAudits(this.db, sessionId, limit);
  }

  async testConnection(profile: ModelProfile, apiKey?: string): Promise<ConnectionTestResult> {
    return await testModelConnection(profile, {
      apiKey: apiKey ?? this.apiKeys[profile.id],
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });
  }

  getApiKey(profileId: string): string | undefined {
    return this.apiKeys[profileId];
  }

  getConfig(): AppConfig | null {
    return this.config;
  }

  getActiveModelProfile(): ModelProfile | null {
    const models = this.config?.models;
    if (models === undefined || models.profiles.length === 0) {
      return null;
    }
    return (
      models.profiles.find((profile) => profile.id === models.activeProfileId) ??
      models.profiles[0] ??
      null
    );
  }

  hasModel(): boolean {
    return this.getActiveModelProfile() !== null;
  }

  listSessions(limit = 50): SessionRecord[] {
    this.requireUnlocked();
    return this.requireSessions().listSessions(limit);
  }

  getOpenSession(): SessionRecord | null {
    this.requireUnlocked();
    return this.requireSessions().getOpenSession();
  }

  getLastEndedSession(): SessionRecord | null {
    this.requireUnlocked();
    return this.requireSessions().getLastEndedSession();
  }

  getSession(id: string): SessionRecord | null {
    this.requireUnlocked();
    return this.requireSessions().getSession(id);
  }

  listSessionMessages(sessionId: string, limit?: number): MessageRecord[] {
    this.requireUnlocked();
    return this.requireSessions().listMessages(sessionId, limit);
  }

  countUserMessages(sessionId: string): number {
    this.requireUnlocked();
    return this.requireSessions().countUserMessages(sessionId);
  }

  getSessionUsage(sessionId: string): { promptTokens: number; completionTokens: number } {
    this.requireUnlocked();
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    return sumUsageForSession(this.db, sessionId);
  }

  listLetters(limit = 50): LetterRecord[] {
    this.requireUnlocked();
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    return listLetters(this.db, limit);
  }

  countUnreadLetters(): number {
    this.requireUnlocked();
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    return countUnreadLetters(this.db);
  }

  markLetterRead(letterId: string): void {
    this.requireUnlocked();
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    markLetterRead(this.db, letterId, this.now().toISOString());
  }

  listMemoryCards(kind?: MemoryKind) {
    this.requireUnlocked();
    if (this.db === null) {
      return [];
    }
    return listMemoryCards(this.db, {
      status: 'active',
      limit: 200,
      ...(kind !== undefined ? { kind } : {}),
    });
  }

  getMemoryCard(cardId: string) {
    this.requireUnlocked();
    if (this.db === null) {
      return null;
    }
    return getMemoryCard(this.db, cardId);
  }

  updateMemoryText(cardId: string, text: string): void {
    this.requireUnlocked();
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    const trimmed = text.trim();
    if (trimmed.length === 0 || Array.from(trimmed).length > 200) {
      throw new AppServiceError('INVALID_INPUT', '记忆卡文本需要 1–200 字。');
    }
    updateMemoryCardText(this.db, cardId, trimmed, memoryTextHash(trimmed));
  }

  deleteMemoryCards(cardIds: string[]): void {
    this.requireUnlocked();
    if (this.db !== null) {
      deleteMemoryCards(this.db, cardIds);
    }
  }

  clearMemoryCards(): void {
    this.requireUnlocked();
    if (this.db !== null) {
      clearMemoryCards(this.db);
    }
  }

  async backfillMemoryEmbeddings(): Promise<number> {
    this.requireUnlocked();
    const profile = this.getActiveModelProfile();
    if (profile === null || !this.config?.memory.embeddingModel || this.db === null) {
      return 0;
    }
    const service = new MemoryService({
      db: this.db,
      provider: this.chatProviderFactory
        ? this.chatProviderFactory(profile, this.apiKeys[profile.id])
        : new OpenAICompatibleProvider(),
      profile,
      ...(this.apiKeys[profile.id] !== undefined ? { apiKey: this.apiKeys[profile.id] } : {}),
      embeddingModel: this.config.memory.embeddingModel,
      now: this.now,
      timeoutMs: 180_000,
    });
    return await service.backfillEmbeddings(50);
  }

  listMemoryRevisions(cardId: string) {
    this.requireUnlocked();
    if (this.db === null) {
      return [];
    }
    return listMemoryRevisions(this.db, cardId);
  }

  countMemoriesForSession(sessionId: string): number {
    this.requireUnlocked();
    if (this.db === null) {
      return 0;
    }
    return countMemoriesForSession(this.db, sessionId);
  }

  forgetMemoriesForSession(sessionId: string): void {
    this.requireUnlocked();
    if (this.db !== null) {
      deleteMemoriesForSession(this.db, sessionId);
    }
  }

  confirmMemory(cardId: string): void {
    this.requireUnlocked();
    if (this.db !== null) {
      confirmMemoryCard(this.db, cardId);
    }
  }

  archiveMemory(cardId: string): void {
    this.requireUnlocked();
    if (this.db !== null) {
      archiveMemoryCard(this.db, cardId);
    }
  }

  deleteMemory(cardId: string): void {
    this.requireUnlocked();
    if (this.db !== null) {
      deleteMemoryCard(this.db, cardId);
    }
  }

  getMemorySources(cardId: string) {
    this.requireUnlocked();
    if (this.db === null) {
      return null;
    }
    const db = this.db;
    if (db === null) {
      return null;
    }
    const card = getMemoryCard(db, cardId);
    if (card === null) {
      return null;
    }
    const session =
      card.sourceSessionId !== null
        ? this.requireSessions().getSession(card.sourceSessionId)
        : null;
    const messages = card.sourceMessageIds
      .map((id) => getMessage(db, id))
      .filter((message): message is MessageRecord => message !== null)
      .map((message) => ({
        id: message.id,
        role: message.role,
        excerpt: message.content.slice(0, 240),
        createdAt: message.createdAt,
      }));
    return {
      card,
      sessionTitle: session?.title ?? null,
      sessionId: card.sourceSessionId,
      messages,
      recalls: listRecallsForMemory(this.db, card.id, 5),
    };
  }

  async updateMemorySettings(settings: MemorySettings): Promise<AppConfig> {
    this.requireUnlocked();
    const base = this.config;
    if (base === null) {
      throw new AppServiceError('NOT_UNLOCKED', '配置尚未加载。');
    }
    const next = parseAppConfig({
      ...base,
      memory: {
        enabled: settings.enabled,
        includeSensitive: settings.includeSensitive,
      },
    });
    saveAppConfig(this.configPath, next);
    this.config = next;
    return next;
  }

  getSessionMemo(sessionId: string): MemoSnapshot | null {
    this.requireUnlocked();
    return this.requireSessions().getMemoSnapshot(sessionId);
  }

  getLatestReadyMemo() {
    this.requireUnlocked();
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    return getLatestReadyMemoRow(this.db, 'zhiwei');
  }

  createSession(options: { memoId?: string; disableMemory?: boolean } = {}): SessionRecord {
    this.requireUnlocked();
    if (options.memoId === undefined || this.db === null) {
      return this.requireSessions().createSession({
        ...(options.disableMemory === true ? { memoryRecallEnabled: false } : {}),
      });
    }
    const memo = getReadyMemoById(this.db, options.memoId);
    if (memo === null) {
      throw new AppServiceError('INVALID_INPUT', '这份备忘录不可用。');
    }
    return this.requireSessions().createSession({
      ...(options.disableMemory === true
        ? { memoryRecallEnabled: false }
        : { memoSnapshot: buildMemoSnapshot(memo, this.now()) }),
    });
  }

  continueLastSession(): SessionRecord {
    this.requireUnlocked();
    const resumed = this.requireSessions().continueLastEnded();
    if (this.db !== null) {
      markSessionJobsStale(this.db, resumed.id);
      archiveReadyMemosForSession(this.db, resumed.id);
    }
    return resumed;
  }

  endSession(id: string): { deleted: boolean; session: SessionRecord | null } {
    this.requireUnlocked();
    this.activeChat?.abort();
    this.activeChat = null;
    const result = this.requireSessions().endSession(id);
    if (!result.deleted && result.session !== null) {
      try {
        this.createPostSessionService()?.enqueue(id);
        if (this.autoRunPostSession) {
          void this.runPostSession(id).catch(() => {
            // 后台整理失败由任务状态与进度页呈现；不阻塞结束会谈。
          });
        }
      } catch {
        // 整理入队失败不应把已结束的会谈回滚；任务可在下次手动触发。
      }
    }
    return result;
  }

  deleteSession(id: string): boolean {
    this.requireUnlocked();
    this.activeChat?.abort();
    this.activeChat = null;
    return this.requireSessions().deleteSession(id);
  }

  createChat(sessionId: string): ChatService {
    this.requireUnlocked();
    if (this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开。');
    }
    const sessions = this.requireSessions();
    const session = sessions.getSession(sessionId);
    if (session === null) {
      throw new AppServiceError('INVALID_INPUT', '会谈不存在。');
    }
    if (session.status === 'ended') {
      throw new AppServiceError('INVALID_INPUT', '会谈已经结束。');
    }
    const profile = this.getActiveModelProfile();
    if (profile === null) {
      throw new AppServiceError('NO_MODEL', '还没有配置模型，暂时不能开始会谈。');
    }
    const apiKey = this.apiKeys[profile.id];
    const provider = this.chatProviderFactory
      ? this.chatProviderFactory(profile, apiKey)
      : new OpenAICompatibleProvider();
    const safety =
      this.safetyEvaluatorFactory !== undefined
        ? this.safetyEvaluatorFactory(sessionId)
        : new SafetyService({
            db: this.db,
            classifier: new ModelRiskClassifier({
              profile,
              provider,
              ...(apiKey !== undefined ? { apiKey } : {}),
            }),
            now: this.now,
          });
    const memo = sessions.getMemoSnapshot(sessionId);
    this.activeChat?.abort();
    this.activeChat = new ChatService({
      db: this.db,
      sessions,
      profile,
      provider,
      promptSnapshot: sessions.ensurePromptSnapshot(sessionId),
      ...(safety !== undefined ? { safety } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(this.config?.profile.displayName ? { displayName: this.config.profile.displayName } : {}),
      ...(memo !== null ? { memoText: memo.content } : {}),
      memoryEnabled:
        (this.config?.memory.enabled ?? DEFAULT_MEMORY_SETTINGS.enabled) &&
        session.memoryRecallEnabled,
      includeSensitiveMemory:
        this.config?.memory.includeSensitive ?? DEFAULT_MEMORY_SETTINGS.includeSensitive,
      ...(this.config?.memory.embeddingModel
        ? { embeddingModel: this.config.memory.embeddingModel }
        : {}),
      memoryService: new MemoryService({
        db: this.db,
        provider,
        profile,
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(this.config?.memory.embeddingModel
          ? { embeddingModel: this.config.memory.embeddingModel }
          : {}),
        now: this.now,
        timeoutMs: 180_000,
      }),
      contextBudgets: {
        history:
          this.config?.context.historyTokens ?? DEFAULT_CONTEXT_BUDGET_SETTINGS.historyTokens,
        summaryTrigger:
          this.config?.context.summaryTriggerTokens ??
          DEFAULT_CONTEXT_BUDGET_SETTINGS.summaryTriggerTokens,
        recentTarget:
          this.config?.context.recentTargetTokens ??
          DEFAULT_CONTEXT_BUDGET_SETTINGS.recentTargetTokens,
      },
      now: this.now,
    });
    return this.activeChat;
  }

  getCrisisResources(): { resources: CrisisResources; path: string; error?: string } {
    const path = join(this.paths.config, 'crisis-resources.json');
    try {
      return { resources: loadCrisisResources(path), path };
    } catch (error) {
      return {
        resources: EMPTY_CRISIS_RESOURCES,
        path,
        error: error instanceof Error ? error.message : '危机资源文件无法读取。',
      };
    }
  }

  readProfile(): ProfileRecord | null {
    if (this.db === null) {
      return null;
    }
    return getProfile(this.db);
  }

  snapshot(): AppSnapshot {
    const config = this.config ?? loadAppConfig(this.configPath);
    return {
      phase: this.dbKey ? 'unlocked' : 'locked',
      hasVault: vaultExists(this.vaultPath),
      onboardingComplete: Boolean(config?.onboardingCompletedAt),
      config,
    };
  }

  /** 先停止流式并给最后一次落库留出时间，再关闭数据库。 */
  async lockAndFlush(): Promise<void> {
    const chat = this.activeChat;
    this.activeChat = null;
    if (chat !== null) {
      chat.abort();
      await Promise.race([
        chat.whenIdle(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 2000);
        }),
      ]);
    }
    const runs = [...this.postSessionRuns.values()];
    if (runs.length > 0) {
      await Promise.race([
        Promise.allSettled(runs),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 2000);
        }),
      ]);
    }
    this.lock();
  }

  async shutdownAndFlush(): Promise<void> {
    await this.lockAndFlush();
  }

  lock(): void {
    this.activeChat?.abort();
    this.activeChat = null;
    this.closeDatabase();
    this.sessions = null;
    if (this.dbKey) {
      wipe(this.dbKey);
      this.dbKey = null;
    }
    this.apiKeys = {};
    this.config = null;
  }

  shutdown(): void {
    this.lock();
  }

  private assertNotThrottled(): void {
    const remaining = this.lockout.blockedForMs();
    if (remaining > 0) {
      throw new AppServiceError(
        'LOCKED_OUT',
        '尝试过于频繁，请 ' + Math.ceil(remaining / 1000) + ' 秒后再试。',
        { retryAfterMs: remaining },
      );
    }
  }

  private requireUnlocked(): void {
    if (this.dbKey === null || this.db === null) {
      throw new AppServiceError('NOT_UNLOCKED', '保险库尚未解锁。');
    }
  }

  private requireSessions(): SessionService {
    if (this.sessions === null) {
      throw new AppServiceError('NOT_UNLOCKED', '保险库尚未解锁。');
    }
    return this.sessions;
  }

  private loadOrCreateConfig(vaultCreatedAt: string): AppConfig {
    const existing = loadAppConfig(this.configPath);
    if (existing !== null) {
      return existing;
    }
    // 极端情况下配置丢失但保险库还在：用保险库创建时间补一份最小配置，
    // 保留访问能力，并让用户重新走一遍档案与模型设置。
    const createdAt = new Date(vaultCreatedAt);
    const fallback = createInitialConfig(
      Number.isNaN(createdAt.getTime()) ? this.now() : createdAt,
      systemTimezone(),
    );
    saveAppConfig(this.configPath, fallback);
    return fallback;
  }

  private applyApiKeys(config: AppConfig, keys: ApiKeyMap | undefined): void {
    if (keys === undefined) {
      return;
    }
    if (this.dbKey === null) {
      throw new AppServiceError('NOT_UNLOCKED', '数据库尚未打开，无法保存密钥。');
    }
    const allowed = new Set(config.models.profiles.map((profile) => profile.id));
    const filtered: ApiKeyMap = {};
    for (const [id, value] of Object.entries(keys)) {
      if (!allowed.has(id)) {
        continue;
      }
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        filtered[id] = trimmed;
      }
    }
    saveSecretsFile(this.secretsPath, this.dbKey, filtered);
    this.apiKeys = filtered;
  }

  private async openDatabase(key: Buffer): Promise<void> {
    this.closeDatabase();
    const db = openEncryptedDatabase(this.databasePath, key);
    try {
      await runMigrations(db, {
        backup: async () => {
          await backupDatabase(db, this.backupDir, { now: this.now() });
        },
      });
      recoverStreamingMessages(db);
      resetRunningPostSessionJobs(db);
      this.db = db;
      this.sessions = new SessionService(db, { now: this.now });
      this.sessions.cleanupEmptyDrafts();
    } catch (error) {
      this.sessions = null;
      try {
        db.close();
      } catch {
        // 关闭失败不掩盖迁移错误。
      }
      throw error;
    }
  }

  private closeDatabase(): void {
    if (this.db !== null) {
      try {
        this.db.close();
      } finally {
        this.db = null;
      }
    }
  }
}
