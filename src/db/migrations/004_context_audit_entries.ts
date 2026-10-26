import type { DatabaseConnection } from '../database.js';

export const migration004 = {
  version: 4,
  name: 'context_audit_entries',
  up(db: DatabaseConnection): void {
    // 只记录消息 ID、角色、token 与是否进入请求；不保存正文。
    db.exec(`
      ALTER TABLE context_audits
      ADD COLUMN entries_json TEXT NOT NULL DEFAULT '[]';
    `);
  },
};
