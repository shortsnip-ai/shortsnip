import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const source = readFileSync(
  new URL('../server.js', import.meta.url),
  'utf8'
);

test('server.js has valid JavaScript syntax', () => {
  const result = spawnSync(process.execPath, ['--check', 'server.js'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
});

test('jobTools.js has valid JavaScript syntax', () => {
  const result = spawnSync(
    process.execPath,
    ['--check', 'jobTools.js'],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
});

test('server.js does not use undefined CommonJS globals', () => {
  assert.doesNotMatch(source, /\b__dirname\b/);
  assert.doesNotMatch(source, /\b__filename\b/);
  assert.doesNotMatch(source, /\brequire\s*\(/);
});

test('server.js does not contain YouTube bypass options', () => {
  assert.doesNotMatch(source, /cookies-from-browser|extractor-args.*youtube/i);
});