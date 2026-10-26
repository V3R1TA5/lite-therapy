import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CrisisResourcesError, loadCrisisResources } from '../src/services/crisisResources.js';

const roots: string[] = [];

function tempFile(): string {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-crisis-'));
  roots.push(root);
  return join(root, 'crisis-resources.json');
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('crisis resources', () => {
  it('returns an empty list when the file is missing', () => {
    expect(loadCrisisResources(tempFile())).toEqual({ version: 1, resources: [] });
  });

  it('loads user-provided resources without adding built-in numbers', () => {
    const path = tempFile();
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        resources: [
          {
            region: '测试地区',
            emergency: '请填写当地急救电话',
            crisis_line: '请填写当地危机热线',
            notes: '测试数据，不是真实号码。',
            source_url: 'https://example.org/resources',
            verified_at: '2026-10-26',
          },
        ],
      }),
    );

    const loaded = loadCrisisResources(path);
    expect(loaded.resources).toHaveLength(1);
    expect(loaded.resources[0]?.region).toBe('测试地区');
    expect(loaded.resources[0]?.crisis_line).toBe('请填写当地危机热线');
  });

  it('accepts a single resource object', () => {
    const path = tempFile();
    writeFileSync(
      path,
      JSON.stringify({ region: '本地', notes: '请自行核对', source_url: 'https://example.org' }),
    );
    expect(loadCrisisResources(path).resources).toHaveLength(1);
  });

  it('rejects corrupt JSON and unexpected fields', () => {
    const path = tempFile();
    writeFileSync(path, '{bad json');
    expect(() => loadCrisisResources(path)).toThrow(CrisisResourcesError);

    writeFileSync(path, JSON.stringify({ resources: [], unexpected: true }));
    expect(() => loadCrisisResources(path)).toThrow(CrisisResourcesError);
  });
});
