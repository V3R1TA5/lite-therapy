import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT OR Apache-2.0',
  'MIT OR CC0-1.0',
  'Python-2.0',
  'Unlicense',
]);

interface PackageJson {
  name?: string;
  version?: string;
  license?: unknown;
  dependencies?: Record<string, string>;
}

function licenseOf(value: unknown): string {
  if (typeof value === 'string') {
    return value.replace(/^\((.*)\)$/, '$1').trim();
  }
  if (Array.isArray(value)) {
    return value.map(licenseOf).filter(Boolean).join(' OR ');
  }
  if (value !== null && typeof value === 'object' && 'type' in value) {
    return String((value as { type: unknown }).type);
  }
  return '';
}

function readPackage(name: string): PackageJson | null {
  try {
    return JSON.parse(
      readFileSync(join(process.cwd(), 'node_modules', name, 'package.json'), 'utf8'),
    ) as PackageJson;
  } catch {
    return null;
  }
}

const root = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as PackageJson;
const queue = Object.keys(root.dependencies ?? {});
const seen = new Set<string>();
const reviewed: Array<{ name: string; version: string; license: string }> = [];

while (queue.length > 0) {
  const name = queue.shift();
  if (name === undefined || seen.has(name)) {
    continue;
  }
  seen.add(name);
  const data = readPackage(name);
  if (data === null) {
    continue;
  }
  const license = licenseOf(data.license);
  reviewed.push({
    name: data.name ?? name,
    version: data.version ?? '?',
    license,
  });
  for (const dependency of Object.keys(data.dependencies ?? {})) {
    queue.push(dependency);
  }
}

const unknown = reviewed.filter((item) => !ALLOWED.has(item.license));
console.log('Lite Therapy runtime dependency license check');
console.log('packages scanned: ' + String(reviewed.length));
if (unknown.length > 0) {
  for (const item of unknown) {
    console.log('UNKNOWN | ' + item.name + '@' + item.version + ' | ' + (item.license || 'missing'));
  }
  console.log(String(unknown.length) + ' package(s) need review');
  process.exitCode = 1;
} else {
  console.log('all runtime dependency licenses are in the allowlist');
}
