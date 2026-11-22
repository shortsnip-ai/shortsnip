// Run from the server folder:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeTool, removeJobFiles, safeRemove, sweepExpiredJobs, sweepOrphanFiles } from '../jobTools.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clipforge-test-'));
}
function touch(file, ageMs = 0) {
  fs.writeFileSync(file, 'x');
  if (ageMs) {
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(file, when, when);
  }
}

test('the original crash: fs.rmSync(null) throws, safeRemove does not', () => {
  assert.throws(() => fs.rmSync(null, { force: true }), { code: 'ERR_INVALID_ARG_TYPE' });
  assert.equal(safeRemove(null), false);
  assert.equal(safeRemove(undefined), false);
  assert.equal(safeRemove(''), false);
});

test('safeRemove deletes a file and ignores a missing one', () => {
  const dir = tempDir();
  const file = path.join(dir, 'a.mp4');
  touch(file);
  assert.equal(safeRemove(file), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(safeRemove(path.join(dir, 'missing.mp4')), true);
});

test('sweepExpiredJobs does not throw for a YouTube job whose inputPath is null', () => {
  const dir = tempDir();
  const id = 'job-youtube-1';
  const output = path.join(dir, `${id}-clip.mp4`);
  touch(output);
  const jobs = new Map([[id, { id, status: 'completed', inputPath: null, outputPath: output, createdAt: Date.now() - 2 * 3600_000 }]]);
  const removed = sweepExpiredJobs(jobs, { workDir: dir, ttlMs: 3600_000 });
  assert.equal(removed, 1);
  assert.equal(jobs.size, 0);
  assert.equal(fs.existsSync(output), false);
});

test('sweepExpiredJobs keeps fresh jobs and files', () => {
  const dir = tempDir();
  const output = path.join(dir, 'fresh.mp4');
  touch(output);
  const jobs = new Map([['fresh', { id: 'fresh', status: 'completed', inputPath: null, outputPath: output, createdAt: Date.now() }]]);
  assert.equal(sweepExpiredJobs(jobs, { workDir: dir, ttlMs: 3600_000 }), 0);
  assert.equal(jobs.size, 1);
  assert.equal(fs.existsSync(output), true);
});

test('sweepExpiredJobs does not delete a job that is still processing (older than the TTL, under the 90 minute run limit)', () => {
  const dir = tempDir();
  const jobs = new Map([['busy', { id: 'busy', status: 'processing', inputPath: null, outputPath: path.join(dir, 'busy-clip.mp4'), createdAt: Date.now() - 75 * 60_000 }]]);
  assert.equal(sweepExpiredJobs(jobs, { workDir: dir, ttlMs: 3600_000 }), 0);
  assert.equal(jobs.size, 1);
});

test('sweepExpiredJobs removes a stuck job after the maximum run time', () => {
  const dir = tempDir();
  const jobs = new Map([['stuck', { id: 'stuck', status: 'processing', inputPath: null, outputPath: null, createdAt: Date.now() - 5 * 3600_000 }]]);
  assert.equal(sweepExpiredJobs(jobs, { workDir: dir, ttlMs: 3600_000 }), 1);
});

test('removeJobFiles can keep the finished YouTube clip while removing the source', () => {
  const dir = tempDir();
  const id = 'abc';
  touch(path.join(dir, `${id}.mp4`));          // downloaded source
  touch(path.join(dir, `${id}.f137.mp4`));     // leftover stream
  touch(path.join(dir, `${id}-clip.mp4`));     // finished clip
  touch(path.join(dir, 'other.mp4'));          // another job
  removeJobFiles(dir, id, { includeOutputs: false });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['abc-clip.mp4', 'other.mp4']);
  removeJobFiles(dir, id);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['other.mp4']);
});

test('sweepOrphanFiles removes old unknown files only', () => {
  const dir = tempDir();
  touch(path.join(dir, 'old.mp4'), 3 * 3600_000);
  touch(path.join(dir, 'new.mp4'), 1000);
  const owned = path.join(dir, 'owned-old.mp4');
  touch(owned, 3 * 3600_000);
  const removed = sweepOrphanFiles(dir, { ttlMs: 3600_000, knownPaths: new Set([owned]) });
  assert.equal(removed, 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['new.mp4', 'owned-old.mp4']);
});

test('probeTool reports a working program and its version', async () => {
  const result = await probeTool(process.execPath, ['--version']);
  assert.equal(result.ok, true);
  assert.match(result.version, /^v\d+\./);
});

test('probeTool reports a missing program clearly instead of throwing', async () => {
  const result = await probeTool('snipshort-this-program-does-not-exist', ['--version']);
  assert.equal(result.ok, false);
  assert.match(result.error, /Not found/);
});

test('probeTool reports a program that exits with an error', async () => {
  const result = await probeTool(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(result.ok, false);
  assert.match(result.error, /code 3/);
});

test('probeTool times out a program that hangs', async () => {
  const result = await probeTool(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { timeoutMs: 400 });
  assert.equal(result.ok, false);
  assert.match(result.error, /Timed out/);
});
