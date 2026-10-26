import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Keep Vitest state inside the workspace. This also makes tests work in
// sandboxed environments where the home directory is read-only.
const xdgDataHome = join(process.cwd(), '.tmp', 'vitest-xdg-data');
const viteCacheDir = join(process.cwd(), '.tmp', 'vite');
const fsModuleCachePath = join(process.cwd(), '.tmp', 'vitest-fs-cache');
for (const dir of [xdgDataHome, viteCacheDir, fsModuleCachePath]) {
  mkdirSync(dir, { recursive: true });
}
process.env.XDG_DATA_HOME = xdgDataHome;

export default defineConfig({
  cacheDir: viteCacheDir,
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fsModuleCachePath,
  },
});
