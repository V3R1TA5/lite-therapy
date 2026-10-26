import { render } from 'ink';
import { ensureAppDirs } from '../config/paths.js';
import { AppService } from '../services/appService.js';
import { acquireInstanceLock } from '../services/instanceLock.js';
import { App } from './App.js';

export async function runTui(): Promise<void> {
  if (!process.stdout.isTTY) {
    console.error('Lite Therapy 需要交互式终端。请直接在终端里运行，而不是通过管道。');
    process.exitCode = 1;
    return;
  }

  const paths = ensureAppDirs();
  const acquired = acquireInstanceLock(paths.data);
  if (!acquired.ok) {
    console.error(
      'Lite Therapy 已经在运行（PID ' +
        (acquired.holderPid ?? '未知') +
        '）。同一数据目录只允许一个进程写入。',
    );
    process.exitCode = 1;
    return;
  }

  const release = () => acquired.lock.release();
  process.once('exit', release);

  let service: AppService | null = null;
  try {
    service = new AppService();
    const instance = render(<App service={service} />, {
      alternateScreen: true,
      exitOnCtrlC: false,
      maxFps: 30,
    });

    await instance.waitUntilExit();
  } finally {
    release();
    process.removeListener('exit', release);
    service?.shutdown();
  }
}
