import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { messages } from '../src/i18n/zh-CN.js';
import type { AppService } from '../src/services/appService.js';
import { ModelSetup } from '../src/ui/screens/ModelSetup.js';

function tick(ms = 100): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('ModelSetup DeepSeek preset', () => {
  it('fills DeepSeek base URL and model, then asks for a key', async () => {
    const testConnection = vi.fn().mockResolvedValue({
      ok: false,
      method: 'models',
      detail: '测试失败',
    });
    const service = { testConnection } as unknown as AppService;
    const { stdin, lastFrame } = render(
      <ModelSetup service={service} onDone={vi.fn()} allowSkip={false} />,
    );
    await tick();

    stdin.write('\x1b[B');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain(messages.model.apiKeyTitle);

    stdin.write('sk-test-deepseek');
    await tick();
    stdin.write('\r');
    await tick(300);
    expect(lastFrame()).toContain('https://api.deepseek.com/v1');
    expect(lastFrame()).toContain('deepseek-flash');
    expect(testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-flash',
      }),
      'sk-test-deepseek',
    );
  });
});
