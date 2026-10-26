#!/usr/bin/env node
import { Command } from 'commander';
import { getAppPaths } from './config/paths.js';
import { APP_NAME, APP_VERSION } from './core/version.js';
import { runDiagnostics } from './services/doctor.js';

async function runDoctor(): Promise<void> {
  const checks = await runDiagnostics();
  console.log(APP_NAME + ' ' + APP_VERSION + ' doctor');
  console.log('paths: ' + JSON.stringify(getAppPaths()));
  for (const check of checks) {
    console.log((check.ok ? 'PASS' : 'FAIL') + ' ' + check.name + ': ' + check.detail);
  }
  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

const program = new Command();

program.name('lite-therapy').description('本地优先的 AI 心理咨询 TUI').version(APP_VERSION);

program
  .command('doctor')
  .description('检查 Node、SQLCipher、FTS5、迁移、保险库、密钥与配置')
  .action(async () => {
    await runDoctor();
  });

program.action(async () => {
  // NO_COLOR 要求严格无色。Ink 在模块加载时初始化颜色能力，
  // 所以在动态加载 TUI 之前显式关闭 FORCE_COLOR，连 dim 转义也去掉。
  if (Object.hasOwn(process.env, 'NO_COLOR')) {
    process.env.FORCE_COLOR = '0';
  }
  const { runTui } = await import('./ui/runTui.js');
  await runTui();
});

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
