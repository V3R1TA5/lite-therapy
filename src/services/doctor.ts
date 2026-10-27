import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialConfig, loadAppConfig, saveAppConfig } from '../config/appConfig.js';
import { type AppPaths, ensureDirectories, getAppPaths } from '../config/paths.js';
import {
  assertEncryptedAtRest,
  getCipherVersion,
  getSqliteVersion,
  openEncryptedDatabase,
} from '../db/database.js';
import { runMigrations } from '../db/migrations/index.js';
import { decryptSecrets, encryptSecrets } from '../security/secrets.js';
import { createVault, unlockVault } from '../security/vault.js';
import { formatMode, inspectFilePermissions } from '../security/vaultStore.js';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DiagnosticsOptions {
  paths?: AppPaths;
  platform?: NodeJS.Platform;
}

function checkUserFiles(checks: DoctorCheck[], paths: AppPaths, platform: NodeJS.Platform): void {
  try {
    const vaultPath = join(paths.config, 'vault.json');
    const configPath = join(paths.config, 'config.toml');
    const databasePath = join(paths.data, 'counsel.db');

    const hasVault = existsSync(vaultPath);
    const config = existsSync(configPath) ? loadAppConfig(configPath) : null;
    const state = !hasVault
      ? '未初始化（首次启动会进入设置）'
      : config?.onboardingCompletedAt
        ? '已完成'
        : '保险库已创建，设置尚未完成';
    checks.push({ name: 'setup', ok: true, detail: state });

    if (existsSync(vaultPath)) {
      const report = inspectFilePermissions(vaultPath, platform);
      checks.push({
        name: 'vault_permissions',
        ok: !report.tooOpen,
        detail: report.note ?? 'mode ' + formatMode(report.mode),
      });
    } else {
      checks.push({ name: 'vault_permissions', ok: true, detail: '尚未创建' });
    }

    if (existsSync(configPath)) {
      const report = inspectFilePermissions(configPath, platform);
      checks.push({
        name: 'config_permissions',
        ok: !report.tooOpen,
        detail: report.note ?? 'mode ' + formatMode(report.mode),
      });
    } else {
      checks.push({ name: 'config_permissions', ok: true, detail: '尚未创建' });
    }

    if (existsSync(databasePath)) {
      try {
        assertEncryptedAtRest(databasePath);
        checks.push({ name: 'database_at_rest', ok: true, detail: '非明文 SQLite 头' });
      } catch (error) {
        checks.push({
          name: 'database_at_rest',
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      const report = inspectFilePermissions(databasePath, platform);
      checks.push({
        name: 'database_permissions',
        ok: !report.tooOpen,
        detail: report.note ?? 'mode ' + formatMode(report.mode),
      });
    } else {
      checks.push({ name: 'database_at_rest', ok: true, detail: '尚未创建' });
    }
  } catch (error) {
    checks.push({ name: 'user_files', ok: false, detail: String(error) });
  }
}

/**
 * 本地自检。CLI 的 doctor 与设置页复用同一套检查；
 * 结果是功能与文件权限，不读取会谈正文，也不解锁用户保险库。
 */
export async function runDiagnostics(options: DiagnosticsOptions = {}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const paths = options.paths ?? getAppPaths();
  const platform = options.platform ?? process.platform;

  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  checks.push({ name: 'node', ok: major >= 22, detail: process.version });

  try {
    ensureDirectories(paths);
    checks.push({ name: 'data_dir', ok: true, detail: paths.data });
  } catch (error) {
    checks.push({ name: 'data_dir', ok: false, detail: String(error) });
  }

  const dir = mkdtempSync(join(tmpdir(), 'lite-therapy-doctor-'));
  try {
    const key = Buffer.alloc(32, 7);
    const dbPath = join(dir, 'doctor.db');
    const db = openEncryptedDatabase(dbPath, key);
    const migration = await runMigrations(db);
    const secondRun = await runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = tables.map((row) => row.name);
    checks.push({
      name: 'migrations',
      ok:
        migration.applied.join(',') === '1,2,3,4,5,6,7,8' &&
        secondRun.applied.length === 0 &&
        names.includes('profile') &&
        names.includes('sessions') &&
        names.includes('messages') &&
        names.includes('risk_events') &&
        names.includes('rolling_summaries') &&
        names.includes('context_audits') &&
        names.includes('post_session_jobs') &&
        names.includes('memos') &&
        names.includes('letters') &&
        names.includes('memory_cards') &&
        names.includes('memory_recalls') &&
        names.includes('memory_card_revisions'),
      detail:
        '001_init + 002_sessions + 003_safety + 004_context_audit_entries + 005_post_session + 006_memory + 007_session_memory_switch + 008_memory_history 可应用且幂等',
    });

    db.exec("CREATE VIRTUAL TABLE fts_probe USING fts5(content, tokenize='trigram')");
    db.prepare('INSERT INTO fts_probe (content) VALUES (?)').run('心理咨询 第一次会谈');
    const hit = db.prepare('SELECT content FROM fts_probe WHERE fts_probe MATCH ?').get('心理咨');
    checks.push({ name: 'sqlcipher', ok: true, detail: getCipherVersion(db) });
    checks.push({ name: 'sqlite', ok: true, detail: getSqliteVersion(db) });
    checks.push({
      name: 'fts5',
      ok: Boolean(hit),
      detail: hit ? 'trigram 中文检索可用' : '中文检索无结果',
    });
    const dbReport = inspectFilePermissions(dbPath, platform);
    checks.push({
      name: 'database_mode',
      ok: !dbReport.tooOpen,
      detail: dbReport.note ?? 'mode ' + formatMode(dbReport.mode),
    });
    db.close();

    const reopened = openEncryptedDatabase(dbPath, key);
    const row = reopened.prepare('SELECT count(*) AS n FROM fts_probe').get() as { n: number };
    reopened.close();
    checks.push({ name: 'reopen', ok: row.n === 1, detail: '加密库重开正常' });

    let wrongKeyRejected = false;
    try {
      const wrong = openEncryptedDatabase(dbPath, Buffer.alloc(32, 8));
      wrong.close();
    } catch {
      wrongKeyRejected = true;
    }
    checks.push({ name: 'wrong_key', ok: wrongKeyRejected, detail: '错误密钥被拒绝' });
  } catch (error) {
    checks.push({ name: 'database', ok: false, detail: String(error) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  try {
    const created = await createVault('doctor test passphrase', {
      kdf: { N: 1024, r: 8, p: 1, dkLen: 32 },
    });
    const unlocked = await unlockVault(created.vault, 'doctor test passphrase');
    checks.push({
      name: 'vault',
      ok: unlocked.equals(created.dbKey),
      detail: 'scrypt + AES-256-GCM + 12 词恢复短语',
    });
  } catch (error) {
    checks.push({ name: 'vault', ok: false, detail: String(error) });
  }

  try {
    const secretKey = Buffer.alloc(32, 11);
    const probe = 'sk-doctor-probe';
    const encrypted = encryptSecrets(secretKey, { doctor: probe });
    const decrypted = decryptSecrets(secretKey, encrypted);
    const fileText = JSON.stringify(encrypted);
    checks.push({
      name: 'secrets',
      ok: decrypted.doctor === probe && !fileText.includes(probe),
      detail: 'API Key 加密且不落明文',
    });
  } catch (error) {
    checks.push({ name: 'secrets', ok: false, detail: String(error) });
  }

  const configDir = mkdtempSync(join(tmpdir(), 'lite-therapy-config-'));
  try {
    const configPath = join(configDir, 'config.toml');
    saveAppConfig(configPath, createInitialConfig(new Date(), 'UTC'));
    const loaded = loadAppConfig(configPath);
    const text = readFileSync(configPath, 'utf8');
    const report = inspectFilePermissions(configPath, platform);
    checks.push({
      name: 'config',
      ok: loaded?.version === 1 && !/api[_-]?key/i.test(text) && !report.tooOpen,
      detail: 'TOML 可读写，不含密钥，' + (report.note ?? 'mode ' + formatMode(report.mode)),
    });
  } catch (error) {
    checks.push({ name: 'config', ok: false, detail: String(error) });
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }

  checkUserFiles(checks, paths, platform);
  return checks;
}
