import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const SKIP = new Set([
  '.git',
  '.tmp',
  '.npm-cache',
  '.cache',
  'coverage',
  'dist',
  'release',
  'node_modules',
  // 测试里使用明显假的 sk-test 夹具；发布扫描不把它当真实密钥。
  'tests',
]);

const PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'openai-like key', pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: 'api key assignment',
    pattern: /(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"]{12,}['"]/i,
  },
];

interface Finding {
  path: string;
  line: number;
  kind: string;
}

const findings: Finding[] = [];

function scanFile(path: string): void {
  const base = basename(path);
  if (base === '.env' || base.startsWith('.env.')) {
    return;
  }
  let text: string;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 1_000_000) {
      return;
    }
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  if (text.includes('\u0000')) {
    return;
  }
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    for (const { name, pattern } of PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ path, line: index + 1, kind: name });
      }
    }
  }
}

function walk(dir: string): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile()) {
      scanFile(full);
    }
  }
}

walk(process.cwd());
console.log('Lite Therapy secret scan');
if (findings.length > 0) {
  for (const finding of findings) {
    console.log(
      'FOUND | ' +
        relative(process.cwd(), finding.path) +
        ':' +
        String(finding.line) +
        ' | ' +
        finding.kind,
    );
  }
  process.exitCode = 1;
} else {
  console.log('no obvious secrets found');
}
