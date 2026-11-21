import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 1024 * 1024 * 1024);
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS || 60 * 60 * 1000);
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';
const YTDLP_COOKIES_PATH = process.env.YTDLP_COOKIES_PATH || '';
const WORK_DIR = process.env.WORK_DIR || path.join(os.tmpdir(), 'clipforge-jobs');
fs.mkdirSync(WORK_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: FRONTEND_ORIGIN.split(',').map(x => x.trim()), methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '1mb' }));

const jobs = new Map();
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, WORK_DIR),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
    if (!allowed.has(ext)) return cb(new Error('Unsupported file extension. Use MP4, MOV, M4V, WEBM, MKV or AVI.'));
    cb(null, true);
  }
});

function run(command, args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || `Process exited with code ${code}`).slice(-2500)));
    });
  });
}

async function probeDuration(filePath) {
  const { stdout } = await run(FFPROBE_PATH, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath
  ], { timeoutMs: 60_000 });
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read video duration.');
  return duration;
}

function buildFilters({ format, fit, effect, duration }) {
  let filters = [];
  if (format === '9:16') {
    filters.push(fit === 'blur'
      ? 'split[fg][bg];[bg]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=20:10[bg];[fg]scale=720:1280:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2'
      : fit === 'pad'
        ? 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black'
        : 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280');
  } else if (format === '1:1') {
    filters.push('scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080');
  } else {
    filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  }

  if (effect === 'cinematic') filters.push('eq=contrast=1.18:saturation=1.24:gamma=0.96', 'colorbalance=rs=-0.05:bs=0.06:rh=0.05:bh=-0.04', 'vignette=PI/5');
  if (effect === 'vibrant') filters.push('eq=contrast=1.22:saturation=1.48:gamma=0.96', 'unsharp=5:5:1.0:5:5:0.0', 'vignette=PI/5');
  if (effect === 'warm') filters.push('eq=contrast=1.10:saturation=1.28:gamma=1.04', 'colorbalance=rs=0.12:gs=0.03:bs=-0.10:rh=0.10:gh=0.02:bh=-0.08', 'vignette=PI/6');
  if (effect === 'noir') filters.push('hue=s=0', 'eq=contrast=1.42:brightness=-0.025', 'unsharp=5:5:0.7:5:5:0.0', 'vignette=PI/4');
  if (effect === 'retro') filters.push('eq=contrast=0.92:saturation=0.78:gamma=1.08', 'colorbalance=rs=0.10:gs=0.02:bs=-0.10:rm=0.04:bm=-0.04', 'noise=alls=8:allf=t+u', 'vignette=PI/5');
  if (effect === 'dreamy') filters.push('eq=contrast=0.90:saturation=1.16:brightness=0.025', 'gblur=sigma=0.7', 'vignette=PI/7');
  if (effect === 'punch') filters.push('eq=contrast=1.28:saturation=1.32:gamma=0.94', 'unsharp=7:7:1.35:7:7:0.0');
  if (effect === 'zoom') {
    // Crop/scale zoom is gradual and keeps output dimensions even.
    filters.push(`scale=iw*1.18:ih*1.18:eval=frame,crop=iw/1.12:ih/1.12:x=(in_w-out_w)*(t/${duration})/1:y=(in_h-out_h)*(t/${duration})/1`);
  }
  if (effect === 'fade') filters.push(`fade=t=in:st=0:d=0.6,fade=t=out:st=${Math.max(0, duration - 0.6)}:d=0.6`);
  return filters.join(',');
}

function makeArgs({ input, output, start, end, format, fit, effect, hasAudio }) {
  const duration = end - start;
  const args = ['-hide_banner', '-ss', String(start), '-i', input, '-t', String(duration), '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-vf', buildFilters({ format, fit, effect, duration })];
  if (effect === 'fade' && hasAudio) args.push('-af', `afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0, duration - 0.6)}:d=0.6`);
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', output);
  return args;
}

function publicJob(job) {
  return { id: job.id, status: job.status, progress: job.progress, error: job.error || null, downloadUrl: job.status === 'completed' ? `/api/jobs/${job.id}/download` : null };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ClipForge AI processing API', ffmpeg: FFMPEG_PATH }));

// YouTube URL clipping. Use only for videos the requester owns or is explicitly
// authorised to download and edit, and only where the acquisition method is permitted.
function isYouTubeUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return ['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)
      && (u.protocol === 'https:' || u.protocol === 'http:');
  } catch { return false; }
}

function cleanupJobFiles(id) {
  for (const name of fs.readdirSync(WORK_DIR)) {
    if (name.startsWith(`${id}.`)) fs.rmSync(path.join(WORK_DIR, name), { force: true });
  }
}

app.post('/api/youtube-jobs', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const start = Number(req.body?.start);
  const end = Number(req.body?.end);
  const { format = 'original', fit = 'crop', effect = 'normal' } = req.body || {};
  const rightsConfirmed = req.body?.rightsConfirmed === true;

  if (!isYouTubeUrl(url)) return res.status(400).json({ error: 'Enter a valid YouTube video URL.' });
  if (!rightsConfirmed) return res.status(400).json({ error: 'Confirm that you own this video or have permission to download and edit it, and that your acquisition method is authorised.' });
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 180) {
    return res.status(400).json({ error: 'Choose a valid clip range of up to 180 seconds.' });
  }
  if (!['original', '9:16', '1:1'].includes(format) || !['crop', 'blur', 'pad'].includes(fit) || !['normal', 'cinematic', 'zoom', 'fade', 'vibrant', 'warm', 'noir', 'retro', 'dreamy', 'punch'].includes(effect)) {
    return res.status(400).json({ error: 'Invalid export settings.' });
  }

  const id = randomUUID();
  const outputPath = path.join(WORK_DIR, `${id}-clip.mp4`);
  const sourceTemplate = path.join(WORK_DIR, `${id}.%(ext)s`);
  const job = { id, status: 'queued', progress: 0, inputPath: null, outputPath, createdAt: Date.now(), error: null };
  jobs.set(id, job);
  res.status(202).json(publicJob(job));

  (async () => {
    try {
      job.status = 'processing';
      job.progress = 5;
      const section = `*${start}-${end}`;
      const ytResult = await run(YTDLP_PATH, [
  '--plugin-dirs', path.join(__dirname, 'yt-dlp-plugins'),
  '--extractor-args',
  'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
  '--no-playlist', '--no-warnings', '--no-part', '--force-overwrites',
  '--download-sections', section,
  '--force-keyframes-at-cuts',
  '--print', 'after_move:filepath',
  '-f', 'bv*+ba/b', '--merge-output-format', 'mp4',
  '-o', sourceTemplate,
  ...(YTDLP_COOKIES_PATH ? ['--cookies', YTDLP_COOKIES_PATH] : []),
  url
], { timeoutMs: 45 * 60 * 1000 });
      job.progress = 65;

      const printedPath = ytResult.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1);
      const candidates = fs.readdirSync(WORK_DIR)
        .filter(name => name.startsWith(`${id}.`))
        .map(name => path.join(WORK_DIR, name))
        .filter(file => fs.statSync(file).isFile());
      job.inputPath = printedPath && fs.existsSync(printedPath) ? printedPath : candidates[0];
      if (!job.inputPath) throw new Error('yt-dlp completed but no source file was created. Check yt-dlp and FFmpeg installation, URL availability, and permissions.');

      const duration = await probeDuration(job.inputPath);
      const clippedDuration = Math.min(duration, end - start);
      if (clippedDuration <= 0) throw new Error('The downloaded section is empty. Check the selected timestamps.');
      const { stdout } = await run(FFPROBE_PATH, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', job.inputPath], { timeoutMs: 60_000 });
      const hasAudio = Boolean(stdout.trim());
      job.progress = 75;
      await run(FFMPEG_PATH, makeArgs({
        input: job.inputPath, output: outputPath, start: 0, end: clippedDuration,
        format, fit, effect, hasAudio
      }), { timeoutMs: 30 * 60 * 1000 });
      job.status = 'completed';
      job.progress = 100;
    } catch (error) {
      job.status = 'failed';
      job.error = `${error.message || 'YouTube clipping failed.'}`.slice(-2500);
      fs.rmSync(outputPath, { force: true });
    } finally {
      cleanupJobFiles(id);
      job.inputPath = null;
    }
  })();
});

app.post('/api/jobs', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a video file using the "video" field.' });
  const start = Number(req.body.start);
  const end = Number(req.body.end);
  const format = req.body.format || 'original';
  const fit = req.body.fit || 'crop';
  const effect = req.body.effect || 'normal';
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: 'Enter a valid start and end time.' });
  }
  if (!['original', '9:16', '1:1'].includes(format) || !['crop', 'blur', 'pad'].includes(fit) || !['normal', 'cinematic', 'zoom', 'fade', 'vibrant', 'warm', 'noir', 'retro', 'dreamy', 'punch'].includes(effect)) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: 'Invalid export settings.' });
  }

  const id = randomUUID();
  const outputPath = path.join(WORK_DIR, `${id}.mp4`);
  const job = { id, status: 'queued', progress: 0, inputPath: req.file.path, outputPath, createdAt: Date.now(), error: null };
  jobs.set(id, job);
  res.status(202).json(publicJob(job));

  (async () => {
    try {
      job.status = 'processing';
      const duration = await probeDuration(job.inputPath);
      if (end > duration + 0.1) throw new Error(`End time exceeds video duration (${duration.toFixed(2)} seconds).`);
      const { stdout } = await run(FFPROBE_PATH, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', job.inputPath], { timeoutMs: 60_000 });
      const hasAudio = Boolean(stdout.trim());
      await run(FFMPEG_PATH, makeArgs({
        input: job.inputPath, output: job.outputPath, start, end, format, fit, effect, hasAudio
      }), { timeoutMs: 30 * 60 * 1000 });
      job.status = 'completed';
      job.progress = 100;
    } catch (error) {
      job.status = 'failed';
      job.error = error.message || 'Video processing failed.';
      fs.rmSync(job.outputPath, { force: true });
    } finally {
      fs.rmSync(job.inputPath, { force: true });
    }
  })();
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  res.json(publicJob(job));
});

app.get('/api/jobs/:id/download', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'completed' || !fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'The clip is not ready or has expired.' });
  }
  res.download(job.outputPath, `clipforge-${job.id.slice(0, 8)}.mp4`);
});

setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) {
      fs.rmSync(job.inputPath, { force: true });
      fs.rmSync(job.outputPath, { force: true });
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

app.use((err, _req, res, _next) => {
  const message = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
    ? `File is too large. Maximum upload size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`
    : err.message || 'Request failed.';
  res.status(400).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`ClipForge processing API listening on http://localhost:${PORT}`);
  console.log(`Allowed frontend origin: ${FRONTEND_ORIGIN}`);
  console.log('Requires FFmpeg, FFprobe and yt-dlp installed and available on PATH for YouTube URL clipping.');
});
