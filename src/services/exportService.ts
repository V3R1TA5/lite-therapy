import { join } from 'node:path';
import { writeFileAtomic } from '../config/atomicFile.js';
import { AI_DISCLOSURE, APP_NAME, APP_VERSION, DISCLAIMER } from '../core/version.js';
import type { MessageRecord } from '../db/repositories/messageRepository.js';
import type { SessionRecord } from '../db/repositories/sessionRepository.js';

export interface ExportOptions {
  format?: 'markdown' | 'json';
  includeLetter?: boolean;
  includeMemo?: boolean;
  includeMemory?: boolean;
  includeInternal?: boolean;
}

export interface ExportArtifacts {
  letter?: { content: string; createdAt: string } | null;
  memo?: { content: string; createdAt: string } | null;
  memories?: Array<{ kind: string; text: string; createdAt: string }>;
  note?: { content: string; createdAt: string } | null;
  formulation?: { content: string; createdAt: string } | null;
  supervision?: { content: string; createdAt: string } | null;
}

export interface ExportSessionInput {
  session: SessionRecord;
  messages: MessageRecord[];
  timezone: string;
  exportDir: string;
  options?: ExportOptions;
  artifacts?: ExportArtifacts;
  now?: Date;
}

function formatTimestamp(iso: string | null, timezone: string): string {
  if (iso === null) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function statusLabel(status: SessionRecord['status']): string {
  if (status === 'active') {
    return '进行中';
  }
  if (status === 'ended') {
    return '已结束';
  }
  return '草稿';
}

function messageStatusNote(status: MessageRecord['status']): string {
  if (status === 'interrupted') {
    return '\n\n（这条回复生成中断。）';
  }
  if (status === 'failed') {
    return '\n\n（这条回复生成失败。）';
  }
  return '';
}

export function formatSessionMarkdown(
  input: Omit<ExportSessionInput, 'exportDir' | 'now'>,
): string {
  const { session, messages, timezone } = input;
  const options = input.options ?? {};
  const artifacts = input.artifacts ?? {};
  const includeLetter = options.includeLetter ?? true;
  const includeMemo = options.includeMemo ?? false;
  const includeMemory = options.includeMemory ?? false;
  const includeInternal = options.includeInternal ?? false;
  const lines: string[] = [
    '> ' + APP_NAME + ' 导出的会谈记录。',
    '> ' + DISCLAIMER,
    '> ' + AI_DISCLOSURE,
    '',
    '# ' + session.title,
    '',
    '- 状态：' + statusLabel(session.status),
    '- 开始：' + formatTimestamp(session.startedAt, timezone),
    '- 结束：' + formatTimestamp(session.endedAt, timezone),
    '- 会谈 ID：' + session.id,
    '',
    '## 对话',
    '',
  ];

  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }
    const role = message.role === 'user' ? '你' : '知微';
    lines.push(
      '### ' + role + ' · ' + formatTimestamp(message.createdAt, timezone),
      '',
      message.content.trim().length > 0 ? message.content : '（空）',
      messageStatusNote(message.status),
      '',
    );
  }

  if (includeLetter && artifacts.letter !== undefined && artifacts.letter !== null) {
    lines.push(
      '## 来信',
      '',
      formatTimestamp(artifacts.letter.createdAt, timezone),
      '',
      artifacts.letter.content,
      '',
    );
  }

  if (includeMemo && artifacts.memo !== undefined && artifacts.memo !== null) {
    lines.push(
      '## 备忘录（内部工作假设）',
      '',
      formatTimestamp(artifacts.memo.createdAt, timezone),
      '',
      artifacts.memo.content,
      '',
    );
  }

  if (includeMemory && artifacts.memories !== undefined && artifacts.memories.length > 0) {
    const kindLabels: Record<string, string> = {
      fact: '事实',
      theme: '主题',
      relationship: '关系',
      preference: '偏好',
      risk_resource: '风险与资源',
      unfinished: '未完成的话',
    };
    lines.push('## 记忆卡（用户显式选择导出）', '');
    for (const memory of artifacts.memories) {
      lines.push('- [' + (kindLabels[memory.kind] ?? memory.kind) + '] ' + memory.text);
    }
    lines.push('');
  }

  if (includeInternal) {
    const sections: Array<[string, { content: string; createdAt: string } | null | undefined]> = [
      ['单次记录', artifacts.note],
      ['纵向理解', artifacts.formulation],
      ['独立督导', artifacts.supervision],
    ];
    for (const [title, artifact] of sections) {
      if (artifact === undefined || artifact === null) {
        continue;
      }
      lines.push(
        '## ' + title + '（内部记录，不是对你的结论）',
        '',
        formatTimestamp(artifact.createdAt, timezone),
        '',
        artifact.content,
        '',
      );
    }
  }

  const includedNote =
    includeMemory || includeInternal
      ? '本文件不包含 API Key；记忆卡/内部记录是在你显式勾选后才写入的。'
      : '本文件不包含 API Key、记忆卡或内部工作记录。';
  lines.push('---', '', includedNote, '如果你不想保留它，请直接删除该文件。', '');
  return lines.join('\n');
}

export function formatSessionJson(
  input: Omit<ExportSessionInput, 'exportDir' | 'now'>,
  now: Date = new Date(),
): string {
  const options = input.options ?? {};
  const artifacts = input.artifacts ?? {};
  const payload: Record<string, unknown> = {
    app: APP_NAME,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    disclaimer: DISCLAIMER,
    aiDisclosure: AI_DISCLOSURE,
    session: {
      id: input.session.id,
      title: input.session.title,
      status: input.session.status,
      startedAt: input.session.startedAt,
      endedAt: input.session.endedAt,
      createdAt: input.session.createdAt,
    },
    messages: input.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt,
      })),
  };
  if (
    options.includeLetter !== false &&
    artifacts.letter !== undefined &&
    artifacts.letter !== null
  ) {
    payload.letter = artifacts.letter;
  }
  if (options.includeMemo === true && artifacts.memo !== undefined && artifacts.memo !== null) {
    payload.memo = artifacts.memo;
  }
  if (
    options.includeMemory === true &&
    artifacts.memories !== undefined &&
    artifacts.memories.length > 0
  ) {
    payload.memories = artifacts.memories;
  }
  if (options.includeInternal === true) {
    payload.internal = {
      note: artifacts.note ?? null,
      formulation: artifacts.formulation ?? null,
      supervision: artifacts.supervision ?? null,
    };
  }
  return JSON.stringify(payload, null, 2);
}

export function exportSessionToFile(input: ExportSessionInput): string {
  const now = input.now ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const format = input.options?.format ?? 'markdown';
  const extension = format === 'json' ? '.json' : '.md';
  const fileName = 'session-' + input.session.id.slice(0, 8) + '-' + stamp + extension;
  const filePath = join(input.exportDir, fileName);
  const content = format === 'json' ? formatSessionJson(input, now) : formatSessionMarkdown(input);
  writeFileAtomic(filePath, content, 0o600);
  return filePath;
}
