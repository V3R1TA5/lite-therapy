import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertEncryptedAtRest,
  getCipherVersion,
  getSqliteVersion,
  openEncryptedDatabase,
} from '../src/db/database.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'lite-therapy-sqlcipher-'));
const dbPath = join(dir, 'spike.db');
const key = randomBytes(32);
let db: ReturnType<typeof openEncryptedDatabase> | undefined;

try {
  db = openEncryptedDatabase(dbPath, key);
  console.log('cipher_version:', getCipherVersion(db));
  console.log('cipher:', JSON.stringify(db.pragma('cipher')));
  console.log('cipher_provider:', JSON.stringify(db.pragma('cipher_provider')));
  console.log('sqlite_version:', getSqliteVersion(db));

  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL)');
  db.exec("CREATE VIRTUAL TABLE notes_fts USING fts5(content, tokenize='trigram')");
  db.prepare('INSERT INTO notes (content) VALUES (?)').run('心理咨询 第一次会谈');
  db.prepare('INSERT INTO notes_fts (content) VALUES (?)').run('心理咨询 第一次会谈');

  const hit = db.prepare('SELECT content FROM notes_fts WHERE notes_fts MATCH ?').get('心理咨') as
    | { content: string }
    | undefined;
  assert(hit, 'FTS5 查询没有返回结果');
  assert(hit.content.includes('心理咨询'), 'FTS5 返回了错误的内容');
  console.log('fts5:', hit.content);

  db.close();
  db = undefined;

  assertEncryptedAtRest(dbPath);
  console.log('at_rest: encrypted header ok');

  let wrongKeyRejected = false;
  try {
    const wrong = openEncryptedDatabase(dbPath, randomBytes(32));
    wrong.close();
  } catch {
    wrongKeyRejected = true;
  }
  assert(wrongKeyRejected, '错误密钥竟然打开了数据库');
  console.log('wrong_key: rejected');

  const reopened = openEncryptedDatabase(dbPath, key);
  const count = reopened.prepare('SELECT count(*) AS n FROM notes').get() as { n: number };
  assert(count.n === 1, '重新打开后数据丢失');
  reopened.close();
  console.log('reopen: ok');
  console.log('PASS sqlcipher + fts5');
} catch (error) {
  console.error('FAIL sqlcipher + fts5');
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    db?.close();
  } catch {
    // 已关闭。
  }
  rmSync(dir, { recursive: true, force: true });
}
