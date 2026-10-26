import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { MemoryCardRecord } from '../src/db/repositories/memoryRepository.js';
import type { AppService } from '../src/services/appService.js';
import { MemoriesScreen } from '../src/ui/screens/MemoriesScreen.js';

function tick(ms = 60): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function card(id: string, text: string): MemoryCardRecord {
  return {
    id,
    kind: 'theme',
    text,
    textHash: 'hash-' + id,
    sourceSessionId: 'session-1',
    sourceMessageIds: ['message-1'],
    confidence: 0.8,
    sensitivity: 'normal',
    tags: ['工作'],
    status: 'active',
    uncertain: false,
    embedding: null,
    model: 'fake-model',
    promptVersion: 'memory-v1',
    createdAt: '2026-10-26T12:00:00.000Z',
    lastRecalledAt: null,
    recallCount: 0,
  };
}

function stubService(initial: MemoryCardRecord[]): AppService {
  let cards = [...initial];
  return {
    listMemoryCards: () => cards,
    getSession: (id: string) => (id === 'session-1' ? { id, title: '上次会谈' } : null),
    getMemorySources: (id: string) => {
      const found = cards.find((item) => item.id === id);
      return {
        card: found ?? null,
        sessionTitle: '上次会谈',
        sessionId: 'session-1',
        messages: [
          {
            id: 'message-1',
            role: 'user' as const,
            excerpt: '最近工作压力很大',
            createdAt: '2026-10-26T12:00:00.000Z',
          },
        ],
        recalls: [
          {
            id: 'recall-1',
            sessionId: 'session-1',
            messageId: 'message-1',
            memoryId: id,
            score: 0.75,
            reason: 'fts5+coverage',
            createdAt: '2026-10-26T12:00:00.000Z',
          },
        ],
      };
    },
    updateMemoryText: (id: string, text: string) => {
      cards = cards.map((item) => (item.id === id ? { ...item, text } : item));
    },
    archiveMemory: (id: string) => {
      cards = cards.filter((item) => item.id !== id);
    },
    deleteMemory: (id: string) => {
      cards = cards.filter((item) => item.id !== id);
    },
    deleteMemoryCards: (ids: string[]) => {
      cards = cards.filter((item) => !ids.includes(item.id));
    },
    clearMemoryCards: () => {
      cards = [];
    },
    listMemoryRevisions: () => [],
    confirmMemory: (id: string) => {
      cards = cards.map((item) => (item.id === id ? { ...item, uncertain: false } : item));
    },
    countMemoriesForSession: () => cards.length,
    forgetMemoriesForSession: () => {
      cards = [];
    },
  } as unknown as AppService;
}

describe('MemoriesScreen', () => {
  it('opens a card, shows its source and edits the text', async () => {
    const service = stubService([card('memory-1', '工作压力反复出现')]);
    const { stdin, lastFrame, unmount } = render(
      <MemoriesScreen service={service} onBack={vi.fn()} />,
    );
    await tick();

    expect(lastFrame()).toContain('工作压力反复出现');
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('记忆详情');
    expect(lastFrame()).toContain('上次会谈');
    expect(lastFrame()).toContain('最近工作压力很大');
    expect(lastFrame()).toContain('召回记录');
    expect(lastFrame()).toContain('0.75');

    stdin.write('\r'); // edit
    await tick();
    expect(lastFrame()).toContain('编辑记忆');
    stdin.write('\x15'); // Ctrl+U clear
    await tick(20);
    stdin.write('新的记忆文本');
    await tick(20);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('新的记忆文本');

    unmount();
  });

  it('archives a card and deletes another after confirmation', async () => {
    const service = stubService([
      card('memory-1', '工作压力反复出现'),
      card('memory-2', '需要被删除的记忆'),
    ]);
    const { stdin, lastFrame, unmount } = render(
      <MemoriesScreen service={service} onBack={vi.fn()} />,
    );
    await tick();

    stdin.write('\r');
    await tick();
    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\r'); // archive
    await tick();
    expect(lastFrame()).toContain('记忆已归档');
    expect(lastFrame()).not.toContain('工作压力反复出现');

    stdin.write('\r'); // open remaining
    await tick();
    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\r'); // delete
    await tick();
    expect(lastFrame()).toContain('删除这条记忆？');
    stdin.write('\r'); // confirm delete
    await tick();
    expect(lastFrame()).toContain('记忆已删除');

    unmount();
  });

  it('filters by kind and forgets the filtered cards after confirmation', async () => {
    const service = stubService([
      card('memory-1', '工作压力反复出现'),
      card('memory-2', '另一个主题'),
    ]);
    const { stdin, lastFrame, unmount } = render(
      <MemoriesScreen service={service} onBack={vi.fn()} />,
    );
    await tick();

    stdin.write('f');
    await tick();
    expect(lastFrame()).toContain('筛选：事实');

    stdin.write('x');
    await tick();
    expect(lastFrame()).toContain('忘记记忆');
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('选中的记忆已删除');
    expect(lastFrame()).toContain('还没有记忆卡');

    unmount();
  });

  it('forgets every card from the same source session', async () => {
    const service = stubService([
      card('memory-1', '工作压力反复出现'),
      card('memory-2', '另一个同会谈记忆'),
    ]);
    const { stdin, lastFrame, unmount } = render(
      <MemoriesScreen service={service} onBack={vi.fn()} />,
    );
    await tick();

    stdin.write('\r');
    await tick();
    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\x1b[B');
    await tick(20);
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('删除这次会谈的记忆？');
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('这次会谈的记忆已删除');
    expect(lastFrame()).toContain('还没有记忆卡');

    unmount();
  });

  it('filters by tag with t', async () => {
    const first = card('memory-1', '工作压力反复出现');
    const second = { ...card('memory-2', '家庭关系'), tags: ['家庭'] };
    const service = stubService([first, second]);
    const { stdin, lastFrame, unmount } = render(
      <MemoriesScreen service={service} onBack={vi.fn()} />,
    );
    await tick();

    stdin.write('t');
    await tick();
    expect(lastFrame()).toContain('标签：工作');
    expect(lastFrame()).toContain('工作压力反复出现');
    expect(lastFrame()).not.toContain('家庭关系');

    stdin.write('t');
    await tick();
    expect(lastFrame()).toContain('家庭关系');

    unmount();
  });
});
