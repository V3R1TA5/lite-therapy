import { randomUUID } from 'node:crypto';
import type { ModelProfile } from '../config/appConfig.js';
import type { DatabaseConnection } from '../db/database.js';
import type { MessageRecord } from '../db/repositories/messageRepository.js';
import {
  enqueuePostSessionJobs,
  getLatestCaseFormulation,
  getLatestSessionNote,
  getLatestSupervision,
  getPostSessionJob,
  insertCaseFormulation,
  insertLetter,
  insertMemo,
  insertSessionNote,
  insertSupervision,
  listPostSessionJobs,
  listRecentSessionNotes,
  markSessionJobsStale,
  type PostSessionJobKind,
  type PostSessionJobRecord,
  setJobFailed,
  setJobQueued,
  setJobReady,
  setJobRunning,
  setJobSkipped,
} from '../db/repositories/postSessionRepository.js';
import { getSession, type SessionRecord } from '../db/repositories/sessionRepository.js';
import type { ChatProvider } from '../providers/types.js';
import { MemoryService } from './memoryService.js';
import type { SessionService } from './sessionService.js';

const ENABLED_KINDS: readonly PostSessionJobKind[] = [
  'session_note',
  'case_formulation',
  'supervision',
  'memo',
  'letter',
  'memory',
];

const NOTE_SYSTEM = [
  '你是知微的内部会谈记录助手。只整理这次会谈，不提供新建议，不做诊断。',
  '用中文输出结构化工作记录：主题、情绪变化、重要事件、重复模式、未完成的话、风险线索、下次可以关注什么。',
  '不写人格定论，不写诊断标签，不写自伤或自杀的方法细节。只输出记录正文。',
].join('\n');

const FORMULATION_SYSTEM = [
  '你是知微的内部个案理解助手。根据本次原文、最近几次单次记录与上一版纵向理解，更新一份工作假设。',
  '保留：反复出现的主题、重要关系与事件、来访者自己的措辞、已尝试的应对、未完成的话。',
  '不写诊断、不写人格定论、不把假设当成事实、不写自伤或自杀的方法细节。',
  '输出中文正文，不超过 3000 字。只输出纵向理解正文。',
].join('\n');

const SUPERVISION_SYSTEM = [
  '你是独立督导。审阅这次会谈原文、单次记录与纵向理解，指出可能的盲点、反移情风险、伦理与安全风险，以及下一次可以怎样更稳。',
  '不诊断、不贴人格标签、不写自伤或自杀的方法细节。督导意见只给内部参考，不直接对来访者说。',
  '输出中文正文，不超过 2000 字。只输出督导意见。',
].join('\n');

const MEMO_SYSTEM = [
  '你是知微的接续备忘录整理器。把这次会谈压缩成下一次会谈可以安全带入的接续材料。',
  '必须严格使用以下五个标题，并写清内容：',
  '主题：',
  '重要背景：',
  '偏好与资源：',
  '未完成：',
  '下次可以：',
  '总长度不超过 600 字。不写诊断、不写人格定论、不写自伤或自杀的方法细节。只输出备忘录正文。',
].join('\n');

const LETTER_SYSTEM = [
  '你是知微，以 AI 咨询角色的身份给来访者写一封短信。',
  '信要温和、具体、尊重自主，不诊断、不承诺疗效、不制造依赖、不进行浪漫或性角色扮演，不写自伤或自杀的方法细节。',
  '不超过 800 字。只输出信件正文，不要 Markdown 标题，不要解释写作过程。',
].join('\n');

export interface PostSessionServiceOptions {
  db: DatabaseConnection;
  sessions: SessionService;
  provider: ChatProvider;
  profile: ModelProfile;
  apiKey?: string;
  displayName?: string;
  counselorId?: string;
  now?: () => Date;
  newId?: () => string;
  timeoutMs?: number;
  retryDelaysMs?: number[];
  embeddingModel?: string;
  embeddingProvider?: ChatProvider;
  embeddingProfile?: ModelProfile;
  embeddingApiKey?: string | null;
}

export interface RunPostSessionResult {
  jobs: PostSessionJobRecord[];
  stale: boolean;
}

/**
 * 单进程串行 worker。M4/M5 当前执行 session_note → case_formulation → supervision → memo → letter → memory。
 */
export class PostSessionService {
  private readonly db: DatabaseConnection;
  private readonly sessions: SessionService;
  private readonly provider: ChatProvider;
  private readonly profile: ModelProfile;
  private readonly apiKey?: string;
  private readonly displayName?: string;
  private readonly counselorId: string;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: number[];
  private readonly memory: MemoryService;
  private running = false;

  constructor(options: PostSessionServiceOptions) {
    this.db = options.db;
    this.sessions = options.sessions;
    this.provider = options.provider;
    this.profile = options.profile;
    this.apiKey = options.apiKey;
    this.displayName = options.displayName;
    this.counselorId = options.counselorId ?? 'zhiwei';
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => randomUUID());
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.retryDelaysMs = options.retryDelaysMs ?? [5000, 20_000, 60_000];
    this.memory = new MemoryService({
      db: this.db,
      provider: this.provider,
      profile: this.profile,
      ...(this.apiKey !== undefined ? { apiKey: this.apiKey } : {}),
      now: this.now,
      newId: this.newId,
      timeoutMs: this.timeoutMs,
      ...(options.embeddingModel !== undefined ? { embeddingModel: options.embeddingModel } : {}),
      ...(options.embeddingProvider !== undefined
        ? { embeddingProvider: options.embeddingProvider }
        : {}),
      ...(options.embeddingProfile !== undefined
        ? { embeddingProfile: options.embeddingProfile }
        : {}),
      ...(options.embeddingApiKey !== undefined
        ? { embeddingApiKey: options.embeddingApiKey }
        : {}),
    });
  }

  enqueue(sessionId: string): PostSessionJobRecord[] {
    const session = getSession(this.db, sessionId);
    if (session === null) {
      throw new Error('会谈不存在。');
    }
    if (session.status !== 'ended' || session.endedAt === null) {
      throw new Error('只有已结束的会谈可以整理。');
    }
    return enqueuePostSessionJobs(this.db, {
      sessionId,
      sourceEndedAt: session.endedAt,
      model: this.profile.model,
      kinds: ENABLED_KINDS,
      now: this.now().toISOString(),
      newId: this.newId,
    });
  }

  listJobs(sessionId: string): PostSessionJobRecord[] {
    return listPostSessionJobs(this.db, sessionId);
  }

  markStale(sessionId: string): void {
    markSessionJobsStale(this.db, sessionId);
  }

  async retryFailed(sessionId: string): Promise<RunPostSessionResult> {
    for (const job of listPostSessionJobs(this.db, sessionId)) {
      if (job.status === 'failed') {
        setJobQueued(this.db, job.id);
      }
    }
    return await this.run(sessionId);
  }

  async run(sessionId: string): Promise<RunPostSessionResult> {
    if (this.running) {
      return { jobs: listPostSessionJobs(this.db, sessionId), stale: false };
    }
    this.running = true;
    try {
      const jobs = listPostSessionJobs(this.db, sessionId);
      for (const job of jobs) {
        if (job.status !== 'queued') {
          continue;
        }
        const session = getSession(this.db, sessionId);
        if (session === null || !this.isSourceCurrent(session, job.sourceEndedAt)) {
          markSessionJobsStale(this.db, sessionId);
          return { jobs: listPostSessionJobs(this.db, sessionId), stale: true };
        }
        let finished = false;
        while (!finished) {
          setJobRunning(this.db, job.id, this.now().toISOString());
          try {
            await this.execute(job, session);
            if (!this.isSourceCurrent(getSession(this.db, sessionId), job.sourceEndedAt)) {
              markSessionJobsStale(this.db, sessionId);
              return { jobs: listPostSessionJobs(this.db, sessionId), stale: true };
            }
            setJobReady(this.db, job.id, this.now().toISOString());
            finished = true;
          } catch (error) {
            const current = getPostSessionJob(this.db, job.id);
            const attempts = current?.attempts ?? 1;
            const message = error instanceof Error ? error.message : '整理失败。';
            if (attempts >= 3) {
              setJobFailed(
                this.db,
                job.id,
                '已达最大重试次数：' + message,
                this.now().toISOString(),
              );
              finished = true;
            } else {
              setJobQueued(this.db, job.id, message);
              const delay = this.retryDelaysMs[attempts - 1] ?? 0;
              if (delay > 0) {
                await new Promise<void>((resolve) => {
                  setTimeout(resolve, delay);
                });
              }
              if (!this.isSourceCurrent(getSession(this.db, sessionId), job.sourceEndedAt)) {
                markSessionJobsStale(this.db, sessionId);
                return { jobs: listPostSessionJobs(this.db, sessionId), stale: true };
              }
            }
          }
        }
      }
      return { jobs: listPostSessionJobs(this.db, sessionId), stale: false };
    } finally {
      this.running = false;
    }
  }

  private isSourceCurrent(session: SessionRecord | null, sourceEndedAt: string): boolean {
    return (
      session !== null &&
      session.status === 'ended' &&
      session.endedAt !== null &&
      session.endedAt === sourceEndedAt
    );
  }

  private async execute(job: PostSessionJobRecord, session: SessionRecord): Promise<void> {
    if (job.kind === 'session_note') {
      const content = await this.complete(NOTE_SYSTEM, this.transcript(session.id), 3000, 0.2);
      insertSessionNote(this.db, {
        id: this.newId(),
        sessionId: session.id,
        content,
        model: this.profile.model,
        sourceEndedAt: job.sourceEndedAt,
        createdAt: this.now().toISOString(),
      });
      return;
    }
    if (job.kind === 'case_formulation') {
      const previous = getLatestCaseFormulation(this.db, this.counselorId);
      const notes = listRecentSessionNotes(this.db, 3);
      const content = await this.complete(
        FORMULATION_SYSTEM,
        [
          '上一版纵向理解（如有）：\n' + (previous?.content ?? '（无）'),
          '最近三次单次记录（可能包含本次）：\n' +
            notes.map((note) => '· ' + note.content).join('\n\n'),
          '本次会谈原文：\n' + this.transcript(session.id),
        ].join('\n\n'),
        3000,
        0.2,
      );
      const covered = previous?.coveredSessionIds ?? [];
      insertCaseFormulation(this.db, {
        id: this.newId(),
        counselorId: this.counselorId,
        version: (previous?.version ?? 0) + 1,
        content,
        coveredSessionIds: [...new Set([...covered, session.id])],
        model: this.profile.model,
        createdAt: this.now().toISOString(),
      });
      return;
    }
    if (job.kind === 'supervision') {
      const note = getLatestSessionNote(this.db, session.id);
      const formulation = getLatestCaseFormulation(this.db, this.counselorId);
      const content = await this.complete(
        SUPERVISION_SYSTEM,
        [
          '本次会谈原文：\n' + this.transcript(session.id),
          '单次记录（如有）：\n' + (note?.content ?? '（无）'),
          '纵向理解（如有）：\n' + (formulation?.content ?? '（无）'),
        ].join('\n\n'),
        2000,
        0.3,
      );
      insertSupervision(this.db, {
        id: this.newId(),
        sessionId: session.id,
        content,
        model: this.profile.model,
        sourceEndedAt: job.sourceEndedAt,
        createdAt: this.now().toISOString(),
      });
      return;
    }
    if (job.kind === 'memo') {
      const note = getLatestSessionNote(this.db, session.id);
      const formulation = getLatestCaseFormulation(this.db, this.counselorId);
      const supervision = getLatestSupervision(this.db, session.id);
      const content = await this.complete(
        MEMO_SYSTEM,
        [
          '本次会谈原文：\n' + this.transcript(session.id),
          '单次记录（如有）：\n' + (note?.content ?? '（无）'),
          '纵向理解（如有）：\n' + (formulation?.content ?? '（无）'),
          '督导意见（如有）：\n' + (supervision?.content ?? '（无）'),
        ].join('\n\n'),
        3000,
        0.2,
      );
      this.validateMemo(content);
      insertMemo(this.db, {
        id: this.newId(),
        sessionId: session.id,
        counselorId: this.counselorId,
        content,
        status: 'ready',
        model: this.profile.model,
        sourceEndedAt: job.sourceEndedAt,
        createdAt: this.now().toISOString(),
      });
      return;
    }
    if (job.kind === 'letter') {
      const note = getLatestSessionNote(this.db, session.id);
      const content = await this.complete(
        LETTER_SYSTEM,
        [
          this.displayName !== undefined
            ? '来访者希望被称呼为：' + this.displayName
            : '来访者没有填写称呼，用“你”即可。',
          '本次会谈原文：\n' + this.transcript(session.id),
          '内部记录（只作为背景，不要照搬）：\n' + (note?.content ?? '（无）'),
        ].join('\n\n'),
        1200,
        0.7,
      );
      if (content.trim().length === 0) {
        throw new Error('来信为空。');
      }
      if (Array.from(content).length > 800) {
        throw new Error('来信超过 800 字，需要重试。');
      }
      insertLetter(this.db, {
        id: this.newId(),
        sessionId: session.id,
        content,
        model: this.profile.model,
        sourceEndedAt: job.sourceEndedAt,
        createdAt: this.now().toISOString(),
      });
      return;
    }
    if (job.kind === 'memory') {
      await this.memory.extract(session.id);
      return;
    }
    setJobSkipped(this.db, job.id, '该任务尚未实现。', this.now().toISOString());
  }

  private validateMemo(content: string): void {
    const text = content.trim();
    const length = Array.from(text).length;
    if (length === 0 || length > 600) {
      throw new Error('备忘录长度不符合要求。');
    }
    const headings = ['主题：', '重要背景：', '偏好与资源：', '未完成：', '下次可以：'];
    for (const heading of headings) {
      if (!text.includes(heading)) {
        throw new Error('备忘录缺少结构标题：' + heading);
      }
    }
  }

  private transcript(sessionId: string): string {
    return this.sessions
      .listMessages(sessionId)
      .filter(
        (message) =>
          (message.role === 'user' || message.role === 'assistant') &&
          message.content.trim().length > 0,
      )
      .map(
        (message: MessageRecord) =>
          '[' + (message.role === 'user' ? '来访者' : '知微') + ']\n' + message.content,
      )
      .join('\n\n');
  }

  private async complete(
    systemPrompt: string,
    userContent: string,
    maxTokens: number,
    temperature: number,
  ): Promise<string> {
    let output = '';
    for await (const event of this.provider.stream({
      profile: this.profile,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      ...(this.apiKey !== undefined ? { apiKey: this.apiKey } : {}),
      temperature,
      maxTokens,
      timeoutMs: this.timeoutMs,
    })) {
      if (event.type === 'delta') {
        output += event.text;
      }
    }
    const trimmed = output.trim();
    if (trimmed.length === 0) {
      throw new Error('模型没有返回内容。');
    }
    return trimmed;
  }
}
