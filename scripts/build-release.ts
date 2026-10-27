import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { APP_VERSION } from '../src/core/version.js';

interface PackageJson {
  name: string;
  version: string;
}

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
) as PackageJson;

function run(args: string[], env: NodeJS.ProcessEnv): void {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const commandArgs = npmExecPath ? [npmExecPath, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env,
    stdio: 'inherit',
    // npm_execpath 由 npm run 提供，可直接用 node 执行，避免 Windows 上 .cmd 的 shell 拼接。
    shell: !npmExecPath && process.platform === 'win32',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} 失败（退出码 ${result.status ?? 'null'}）`);
  }
}

async function main(): Promise<void> {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (nodeMajor < 22) {
    throw new Error(`需要 Node.js 22 或更新版本，当前是 ${process.versions.node}`);
  }
  if (packageJson.version !== APP_VERSION) {
    throw new Error(
      `package.json (${packageJson.version}) 与 src/core/version.ts (${APP_VERSION}) 版本不一致`,
    );
  }
  if (process.platform === 'darwin') {
    console.warn('macOS 尚未纳入 CI 验收；先按 Linux/Windows 产物验证。');
  }

  const releaseDir = join(root, 'release');
  const tempHome = mkdtempSync(join(tmpdir(), 'lite-therapy-release-'));
  const npmCache = join(tempHome, 'npm-cache');
  const xdgCache = join(tempHome, 'xdg-cache');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LITE_THERAPY_HOME: tempHome,
    npm_config_cache: npmCache,
    XDG_CACHE_HOME: xdgCache,
  };

  try {
    mkdirSync(npmCache, { recursive: true });
    mkdirSync(xdgCache, { recursive: true });
    rmSync(releaseDir, { recursive: true, force: true });
    run(['run', 'release:check'], env);
    mkdirSync(releaseDir, { recursive: true });
    run(['pack', '--pack-destination', releaseDir], env);

    const tarball = join(releaseDir, `${packageJson.name}-${packageJson.version}.tgz`);
    if (!existsSync(tarball)) {
      throw new Error('npm pack 没有生成预期的 tarball：' + tarball);
    }
    const sha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex');
    writeFileSync(tarball + '.sha256', `${sha256}  ${basename(tarball)}\n`);
    writeFileSync(
      join(releaseDir, 'build-info.json'),
      JSON.stringify(
        {
          name: packageJson.name,
          version: packageJson.version,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          builtAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );

    console.log('\nrelease:build 完成');
    console.log('  ' + tarball);
    console.log('  ' + tarball + '.sha256');
    console.log('  size ' + statSync(tarball).size + ' bytes');
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(
    'release:build 失败：' + (error instanceof Error ? error.message : String(error)),
  );
  process.exitCode = 1;
});
