import {
  type ChatProvider,
  ChatProviderError,
  type ChatRequest,
  type ChatStreamEvent,
} from '../../src/providers/types.js';

export type FakeStep = ChatStreamEvent | Error;

export class ScriptedChatProvider implements ChatProvider {
  readonly requests: ChatRequest[] = [];
  private readonly runs: FakeStep[][];
  private readonly delayMs: number;

  constructor(runs: FakeStep[][], options: { delayMs?: number } = {}) {
    this.runs = runs.map((run) => [...run]);
    this.delayMs = options.delayMs ?? 0;
  }

  async *stream(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    this.requests.push(request);
    const run = this.runs.shift() ?? [{ type: 'done' }];
    for (const step of run) {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      if (request.signal?.aborted) {
        throw new ChatProviderError('ABORTED', '已停止生成。');
      }
      if (step instanceof Error) {
        throw step;
      }
      yield step;
    }
  }
}
