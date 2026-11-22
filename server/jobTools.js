// Small, dependency-free helpers used by server.js.
// Kept in their own file so they can be tested without starting Express.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Delete one file without ever throwing.
 * The original cleanup code called fs.rmSync(null), which throws
 * ERR_INVALID_ARG_TYPE even with { force: true } and crashed the server.
 */
export function safeRemove(target) {
  if (typeof target !== 'string' || target.length === 0) return false;
  try {
    fs.rmSync(target, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete files in workDir that belong to a job id.
 * Source files are named <id>.* and the finished YouTube clip is <id>-clip.mp4.
 * With includeOutputs: false only the source files (<id>.*) are removed, which
 * is what happens right after a YouTube job finishes, so the clip stays downloadable.
 */
export function removeJobFiles(workDir, id, { includeOutputs = true } = {}) {
  let names = [];
  try {
    names = fs.readdirSync(workDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const isSource = name.startsWith(`${id}.`);
    const isOutput = name.startsWith(`${id}-`);
    if (isSource || (includeOutputs && isOutput)) {
      if (safeRemove(path.join(workDir, name))) removed += 1;
    }
  }
  return removed;
}

/**
 * Remove jobs (and their files) that are older than ttlMs.
 * Jobs that are still queued or processing are kept until maxRunMs has passed,
 * so a long YouTube job is not deleted while it is still running.
 * Never throws. Returns the number of jobs removed.
 */
export function sweepExpiredJobs(jobs, { workDir, ttlMs, maxRunMs = 90 * 60 * 1000, now = Date.now() }) {
  let removed = 0;
  for (const [id, job] of Array.from(jobs.entries())) {
    try {
      const age = now - (job.createdAt || 0);
      if (age < ttlMs) continue;
      const active = job.status === 'queued' || job.status === 'processing';
      if (active && age < Math.max(maxRunMs, ttlMs)) continue;
      safeRemove(job.inputPath);
      safeRemove(job.outputPath);
      removeJobFiles(workDir, id);
      jobs.delete(id);
      removed += 1;
    } catch (error) {
      console.error(`Cleanup of job ${id} failed:`, error?.message || error);
    }
  }
  return removed;
}

/**
 * Remove old files in workDir that no known job owns (for example, files left
 * over from a previous run of the server). Never throws.
 */
export function sweepOrphanFiles(workDir, { ttlMs, knownPaths = new Set(), now = Date.now() }) {
  let names = [];
  try {
    names = fs.readdirSync(workDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const full = path.join(workDir, name);
    try {
      if (knownPaths.has(full)) continue;
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs < ttlMs) continue;
      if (safeRemove(full)) removed += 1;
    } catch {
      // File vanished or is unreadable; ignore it.
    }
  }
  return removed;
}

/**
 * Run `command args` and report whether it works and what version it prints.
 * Resolves with { command, ok, version, error }. Never rejects.
 */
export function probeTool(command, args = ['-version'], { timeoutMs = 8000 } = {}) {
  return new Promise(resolve => {
    let child = null;
    let output = '';
    let finished = false;
    let timer = null;

    const finish = result => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve({ command, ok: false, version: null, error: null, ...result });
    };

    timer = setTimeout(() => {
      try { child?.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ error: `Timed out after ${Math.round(timeoutMs / 1000)} seconds.` });
    }, timeoutMs);

    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      return finish({ error: error.message });
    }

    const collect = chunk => { if (output.length < 8192) output += chunk.toString(); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', error => {
      finish({
        error: error.code === 'ENOENT'
          ? `Not found: "${command}". Install it, or set its path in the environment variables.`
          : error.message
      });
    });
    child.on('close', code => {
      const firstLine = output.split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
      if (code === 0 && firstLine) finish({ ok: true, version: shortVersion(firstLine) });
      else finish({ error: `Exited with code ${code}${firstLine ? `: ${firstLine.slice(0, 160)}` : '.'}` });
    });
  });
}

/** "ffmpeg version 6.1.1-3ubuntu5 Copyright..." -> "6.1.1-3ubuntu5". Other lines pass through. */
function shortVersion(line) {
  const match = /\bversion\s+(\S+)/i.exec(line);
  return (match ? match[1] : line).slice(0, 120);
}

/** Probe FFmpeg, FFprobe and yt-dlp at the same time. */
export async function checkTools({ ffmpegPath, ffprobePath, ytdlpPath }) {
  const [ffmpeg, ffprobe, ytdlp] = await Promise.all([
    probeTool(ffmpegPath, ['-version']),
    probeTool(ffprobePath, ['-version']),
    probeTool(ytdlpPath, ['--version'])
  ]);
  return { ffmpeg, ffprobe, ytdlp };
}
