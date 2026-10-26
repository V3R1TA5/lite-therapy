import { ConfigError } from '../config/appConfig.js';
import { messages } from '../i18n/zh-CN.js';
import { SecretsError } from '../security/secrets.js';
import { VaultError } from '../security/vault.js';
import { AppServiceError } from '../services/appService.js';

/** 只把已知的安全错误原文给用户；其他异常截断，避免把路径或底层细节铺满界面。 */
export function errorMessage(error: unknown): string {
  if (
    error instanceof AppServiceError ||
    error instanceof ConfigError ||
    error instanceof VaultError ||
    error instanceof SecretsError
  ) {
    return error.message;
  }
  if (error instanceof Error) {
    const text = error.message.trim();
    return text.length > 0 ? text.slice(0, 300) : messages.common.unknownError;
  }
  return messages.common.unknownError;
}
