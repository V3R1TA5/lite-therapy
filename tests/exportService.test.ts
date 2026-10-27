import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageRecord } from '../src/db/repositories/messageRepository.js';
import type { SessionRecord } from '../src/db/repositories/sessionRepository.js';
import {
  exportSessionToFile,
  formatSessionJson,
  formatSessionMarkdown,
} from '../src/services/exportService.js';
import { expectPosixPrivateFile } from './helpers/permissions.js';

const roots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'lite-therapy-export-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const SESSION: SessionRecord = {
  id: 'session-1234-abcd',
  title: '最近的工作与睡眠',
  status: 'ended',
  counselorId: 'zhiwei',
  startedAt: '2026-10-26T10:00:00.000Z',
  resumedAt: '2026-10-26T10:00:00.000Z',
  endedAt: '2026-10-26T10:30:00.000Z',
  riskState: 'none',
  memoryRecallEnabled: true,
  createdAt: '2026-10-26T10:00:00.000Z',
  updatedAt: '2026-10-26T10:30:00.000Z',
};

const MESSAGES: MessageRecord[] = [
  {
    id: 'm1',
    sessionId: SESSION.id,
    role: 'assistant',
    content: '我在这里。你可以慢慢说。',
    status: 'complete',
    tokenEstimate: 12,
    riskLevel: 'none',
    metaJson: '{}',
    createdAt: '2026-10-26T10:00:00.000Z',
  },
  {
    id: 'm2',
    sessionId: SESSION.id,
    role: 'user',
    content: '最近总是睡不好。',
    status: 'complete',
    tokenEstimate: 8,
    riskLevel: 'none',
    metaJson: '{}',
    createdAt: '2026-10-26T10:01:00.000Z',
  },
  {
    id: 'm3',
    sessionId: SESSION.id,
    role: 'assistant',
    content: '听起来这些夜晚很长。',
    status: 'interrupted',
    tokenEstimate: 10,
    riskLevel: 'none',
    metaJson: '{}',
    createdAt: '2026-10-26T10:02:00.000Z',
  },
  {
    id: 'm4',
    sessionId: SESSION.id,
    role: 'system',
    content: 'internal system text',
    status: 'complete',
    tokenEstimate: 3,
    riskLevel: 'none',
    metaJson: '{}',
    createdAt: '2026-10-26T10:03:00.000Z',
  },
];

describe('exportService', () => {
  it('formats a readable Markdown transcript with disclaimers and status notes', () => {
    const markdown = formatSessionMarkdown({
      session: SESSION,
      messages: MESSAGES,
      timezone: 'Asia/Tokyo',
    });

    expect(markdown).toContain('# 最近的工作与睡眠');
    expect(markdown).toContain('不提供诊断、治疗或用药建议');
    expect(markdown).toContain('### 你');
    expect(markdown).toContain('最近总是睡不好。');
    expect(markdown).toContain('（这条回复生成中断。）');
    expect(markdown).not.toContain('internal system text');
    expect(markdown).not.toContain('sk-');
    expect(markdown).toContain('不包含 API Key');
  });

  it('writes the export with 0600 permissions and a session-scoped file name', () => {
    const dir = tempDir();
    const filePath = exportSessionToFile({
      session: SESSION,
      messages: MESSAGES,
      timezone: 'UTC',
      exportDir: dir,
      now: new Date('2026-10-26T12:00:00.000Z'),
    });

    expect(filePath).toContain('session-session-');
    expect(filePath).toMatch(/\.md$/);
    expectPosixPrivateFile(filePath);
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('最近总是睡不好。');

    const jsonPath = exportSessionToFile({
      session: SESSION,
      messages: MESSAGES,
      timezone: 'UTC',
      exportDir: dir,
      options: { format: 'json' },
      now: new Date('2026-10-26T12:00:00.000Z'),
    });
    expect(jsonPath).toMatch(/\.json$/);
    expectPosixPrivateFile(jsonPath);
    expect(JSON.parse(readFileSync(jsonPath, 'utf8'))).toHaveProperty('session.id', SESSION.id);
  });

  it('includes only explicitly selected letters, memos, memories and internal records', () => {
    const base = { session: SESSION, messages: MESSAGES, timezone: 'UTC' };
    const defaultMarkdown = formatSessionMarkdown(base);
    expect(defaultMarkdown).not.toContain('## 来信');
    expect(defaultMarkdown).not.toContain('## 记忆卡');

    const markdown = formatSessionMarkdown({
      ...base,
      options: {
        includeLetter: true,
        includeMemo: true,
        includeMemory: true,
        includeInternal: true,
      },
      artifacts: {
        letter: { content: '这封来信只写给你。', createdAt: '2026-10-26T11:00:00.000Z' },
        memo: { content: '主题：睡眠', createdAt: '2026-10-26T11:00:00.000Z' },
        memories: [
          { kind: 'theme', text: '工作压力反复出现', createdAt: '2026-10-26T11:00:00.000Z' },
        ],
        note: { content: '单次记录正文', createdAt: '2026-10-26T11:00:00.000Z' },
        formulation: { content: '纵向理解正文', createdAt: '2026-10-26T11:00:00.000Z' },
        supervision: { content: '督导正文', createdAt: '2026-10-26T11:00:00.000Z' },
      },
    });

    expect(markdown).toContain('## 来信');
    expect(markdown).toContain('## 备忘录（内部工作假设）');
    expect(markdown).toContain('## 记忆卡（用户显式选择导出）');
    expect(markdown).toContain('工作压力反复出现');
    expect(markdown).toContain('## 单次记录（内部记录，不是对你的结论）');
    expect(markdown).toContain('纵向理解正文');
    expect(markdown).toContain('督导正文');
    expect(markdown).toContain('显式勾选后才写入');
  });

  it('writes structured JSON without raw keys and only selected artifacts', () => {
    const json = formatSessionJson(
      {
        session: SESSION,
        messages: MESSAGES,
        timezone: 'UTC',
        options: { includeLetter: true, includeMemory: true, includeInternal: false },
        artifacts: {
          letter: { content: '来信正文', createdAt: '2026-10-26T11:00:00.000Z' },
          memories: [{ kind: 'theme', text: '工作压力', createdAt: '2026-10-26T11:00:00.000Z' }],
        },
      },
      new Date('2026-10-26T12:00:00.000Z'),
    );
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.app).toBe('Lite Therapy');
    expect((parsed.session as Record<string, unknown>).id).toBe(SESSION.id);
    expect((parsed.messages as unknown[]).length).toBe(3);
    expect((parsed.letter as Record<string, unknown>).content).toBe('来信正文');
    expect((parsed.memories as unknown[]).length).toBe(1);
    expect(parsed.memo).toBeUndefined();
    expect(parsed.internal).toBeUndefined();
    expect(json).not.toContain('sk-');
    expect(json).not.toContain('internal system text');
  });
});
