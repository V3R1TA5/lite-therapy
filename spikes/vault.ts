import {
  createVault,
  DEFAULT_KDF,
  recoverVault,
  rewrapPassphrase,
  unlockVault,
} from '../src/security/vault.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const passphrase = 'correct horse battery staple';
const newPassphrase = 'a different but still long passphrase';

try {
  const created = await createVault(passphrase, { kdf: DEFAULT_KDF });
  console.log('recovery_words:', created.recoveryPhrase.split(' ').length);
  console.log('kdf:', DEFAULT_KDF.N, DEFAULT_KDF.r, DEFAULT_KDF.p);
  console.log('db_key_prefix:', created.dbKey.subarray(0, 4).toString('hex'));

  const unlocked = await unlockVault(created.vault, passphrase);
  assert(unlocked.equals(created.dbKey), '密码解锁得到的数据库密钥不一致');

  const recovered = await recoverVault(created.vault, created.recoveryPhrase);
  assert(recovered.equals(created.dbKey), '恢复短语解出的数据库密钥不一致');

  let wrongPassphraseRejected = false;
  try {
    await unlockVault(created.vault, 'wrong passphrase');
  } catch {
    wrongPassphraseRejected = true;
  }
  assert(wrongPassphraseRejected, '错误密码竟然解锁成功');

  const rewrapped = await rewrapPassphrase(created.vault, passphrase, newPassphrase);
  const afterChange = await unlockVault(rewrapped, newPassphrase);
  assert(afterChange.equals(created.dbKey), '修改密码后密钥不一致');
  const recoveryAfterChange = await recoverVault(rewrapped, created.recoveryPhrase);
  assert(recoveryAfterChange.equals(created.dbKey), '修改密码后恢复短语失效');

  console.log('PASS vault create / unlock / recover / rewrap');
} catch (error) {
  console.error('FAIL vault');
  console.error(error);
  process.exitCode = 1;
}
