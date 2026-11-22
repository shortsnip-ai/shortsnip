
import './style.css';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { pipeline, env } from '@huggingface/transformers';

import {
  EFFECTS,
  MAX_MANUAL_CLIP_SECONDS,
  MAX_SOURCE_BYTES,
  WARN_SOURCE_BYTES,
  fileStamp,
  formatClock,
  getYouTubeId,
  getYouTubeStart,
  makeExportArgs,
  parseTimestamp,
  planRandomClips,
  validateRange,
  youtubeEmbedLink,
  youtubeWatchLink
} from './clipTools.js';
import { createZip } from './zip.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

const app = document.querySelector('#app');

app.innerHTML = `
<header class="navbar">
  <a class="brand" href="#">✂ ClipForge <span>AI</span></a>
  <nav><a href="#editor">Editor</a><a href="#features">Features</a></nav>
  <span class="free-badge">100% FREE</span>
</header>

<main>
  <section class="hero">
    <div class="eyebrow">✦ YOUR FREE AI VIDEO STUDIO</div>
    <h1>Long videos.<br><span>Short-form magic.</span></h1>
    <p>Turn long videos into engaging vertical clips with AI-powered subtitles.</p>
  </section>

  <section class="editor" id="editor">
    <div class="section-heading">
      <div><span class="step-label">YOUR WORKSPACE</span><h2>Video Studio</h2></div>
      <span class="status" id="status">Ready to start</span>
    </div>

    <div class="import-panel">
      <div class="import-tabs">
        <button class="import-tab active" data-tab="upload" type="button">↑ Upload Video</button>
        <button class="import-tab" data-tab="direct" type="button">↗ Video URL</button>
        <button class="import-tab" data-tab="youtube" type="button">▶ YouTube</button>
      </div>

      <div class="import-content" id="uploadTab">
        <label class="upload-area" for="videoInput" id="uploadArea">
          <div class="upload-icon">↑</div>
          <h3>Drop your video here</h3>
          <p>or click to browse your computer</p>
          <span class="file-info">MP4, MOV, WEBM supported (your browser must be able to play the file)</span>
          <input type="file" id="videoInput" accept="video/*" hidden />
        </label>
        <ul class="cap-list" aria-label="Available with an uploaded video">
          <li class="cap yes">✓ Manual clip</li>
          <li class="cap yes">✓ Random clips</li>
          <li class="cap yes">✓ Effects</li>
          <li class="cap yes">✓ MP4 export</li>
          <li class="cap yes">✓ AI subtitles</li>
        </ul>
      </div>

      <div class="import-content hidden" id="directTab">
        <h3>Import from direct video URL</h3>
        <p>Paste a direct link to an accessible MP4 or WebM file.</p>
        <div class="url-input-row">
          <input type="url" id="directUrl" placeholder="https://example.com/video.mp4" />
          <button id="importDirect" class="import-btn" type="button">Import</button>
        </div>
        <p class="import-note">Use a direct .mp4, .webm or other browser-accessible video file URL. Ordinary webpage links are not direct video URLs; the host must allow CORS. ClipForge cannot bypass CORS restrictions.</p>
        <p class="import-message hidden" id="importMessage" role="status"></p>
        <ul class="cap-list" aria-label="Available with a video URL">
          <li class="cap yes">✓ Manual clip</li>
          <li class="cap yes">✓ Random clips</li>
          <li class="cap yes">✓ Effects</li>
          <li class="cap yes">✓ MP4 export</li>
          <li class="cap yes">✓ AI subtitles</li>
        </ul>
        <p class="import-note">All of these work once the file has been imported, which only happens when the host permits browser access.</p>
      </div>

      <div class="import-content hidden" id="youtubeTab">
        <h3>Preview a YouTube video</h3>
        <p>Paste a YouTube video link to preview it here.</p>
        <div class="url-input-row">
          <input type="url" id="youtubeUrl" placeholder="https://www.youtube.com/watch?v=..." />
          <button id="previewYoutube" class="import-btn" type="button">Preview</button>
        </div>
        <p class="import-note">Preview the video, select a segment and export it using the configured yt-dlp + FFmpeg backend. Use only videos you own or are authorised to download and edit, and only where the acquisition method is permitted.</p>
        <ul class="cap-list" aria-label="Available with YouTube">
          <li class="cap yes">✓ Preview</li>
          <li class="cap yes">✓ Start / end times</li>
          <li class="cap yes">✓ Timestamped link</li>
          <li class="cap yes">✓ MP4 export (backend required)</li>
          <li class="cap no">✗ Random clips (not enabled for URL-only source)</li>
          <li class="cap yes">✓ Effects</li>
          <li class="cap no">✗ AI subtitles (upload source file)</li>
        </ul>
      </div>
    </div>

    <div class="workspace hidden" id="workspace" data-source="file" data-mode="manual" data-tool="clips">
      <div class="notify-row">
        <label><input type="checkbox" id="notifyWhenDone" /> Notify me when processing is finished</label>
        <span>Keep this tab open until the job completes.</span>
      </div>
      <div class="studio-tabs" role="tablist" aria-label="Choose a tool">
        <button class="studio-tab active" type="button" data-tool="clips">✂ Short clip maker</button>
        <button class="studio-tab" type="button" data-tool="subtitles">▤ Subtitles studio</button>
      </div>
      <div class="video-container">
        <video id="videoPreview" controls playsinline></video>
        <iframe id="youtubePreview" class="hidden"
          title="YouTube video preview"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"></iframe>
      </div>

      <div id="youtubeNotice" class="notice youtube-only">
        <strong>YouTube URL mode.</strong>
        Select a segment and export it through the configured yt-dlp + FFmpeg backend. Only process videos you own or are authorised to download and edit, and only where this acquisition method is permitted.
        <label class="rights-confirm"><input type="checkbox" id="ytRightsConfirm" /> I confirm I own this video or have permission to download and edit it, and that this download method is authorised.</label>
        <button class="primary-btn" id="exportYoutubeClip" type="button">✦ Export YouTube segment as MP4</button>
        <p class="import-note" id="ytExportStatus" aria-live="polite">Backend requires yt-dlp, FFmpeg and FFprobe installed on the server.</p>
        <button class="import-btn" id="ytGoUpload" type="button">↑ Or upload an authorised source file</button>
        <div class="youtube-source-upload">
          <input type="file" id="youtubeSourceInput" accept="video/*,.mkv,.avi,.m4v" hidden />
          <button class="primary-btn" id="ytUploadSource" type="button">Upload source file and enable MP4 export</button>
          <p class="import-note" id="ytSourceStatus" aria-live="polite">Upload the matching video file you are authorised to edit. ClipForge will use the YouTube timestamps above to create your MP4.</p>
        </div>
      </div>

      <div class="video-details">
        <div><span class="step-label">SOURCE VIDEO</span><h3 id="fileName">Your video</h3></div>
        <span id="durationLabel" class="duration-label">00:00</span>
      </div>
      <p id="sourceNote" class="import-note hidden"></p>

      <div class="mode-tabs file-only" role="tablist" aria-label="Clipping mode">
        <button class="mode-tab active" data-mode="manual" type="button" role="tab">✂ Manual clip</button>
        <button class="mode-tab" data-mode="random" type="button" role="tab">⚄ Random clip generator</button>
      </div>

      <div class="manual-only" id="manualPanel">
        <div class="controls">
          <div class="field">
            <label for="startTime">Start time (seconds or HH:MM:SS)</label>
            <input type="text" id="startTime" value="00:00:00" inputmode="decimal" autocomplete="off" placeholder="e.g. 5 or 00:00:05" />
            <button class="mini-btn file-only" id="setStartNow" type="button">Use current video time</button>
          </div>
          <div class="field">
            <label for="endTime">End time (seconds or HH:MM:SS)</label>
            <input type="text" id="endTime" value="00:00:30" inputmode="decimal" autocomplete="off" placeholder="e.g. 35 or 00:00:35" />
            <button class="mini-btn file-only" id="setEndNow" type="button">Use current video time</button>
          </div>
        </div>
        <p id="clipSummary" class="clip-summary" aria-live="polite"></p>
        <p id="clipError" class="form-error hidden" role="alert"></p>

        <button class="import-btn wide file-only" id="previewSegment" type="button">▶ Preview selected segment</button>
        <p class="import-note file-only">Segment preview plays the original video between your start and end times. Effects and ratio appear in the exported clip below.</p>

        <div id="youtubeActions" class="youtube-actions youtube-only">
          <button class="import-btn" id="previewYoutubeSegment" type="button">▶ Preview selected YouTube segment</button>
          <button class="import-btn" id="copyYoutubeSegment" type="button">Copy timestamp link</button>
          <button class="import-btn" id="copyYoutubeEmbed" type="button">Copy start–end embed link</button>
        </div>
        <div class="youtube-only yt-link-box">
          <label for="ytLinkOut">Timestamped YouTube link (starts at your start time)</label>
          <input type="text" id="ytLinkOut" readonly />
          <p id="ytCopyMessage" class="import-note" aria-live="polite"></p>
        </div>
      </div>

      <section class="random-panel random-only file-only" id="randomPanel">
        <div class="random-heading">
          <span class="step-label">QUICK CLIPS</span>
          <h2>Random Clip Generator</h2>
          <p>Picks random, non-overlapping sections from your video. These are randomly selected sections, <strong>not AI-detected highlights</strong>.</p>
        </div>
        <div class="random-controls">
          <div class="field">
            <label for="randomDuration">Each clip duration</label>
            <select id="randomDuration" class="effect-select">
              <option value="15">15 seconds</option>
              <option value="30" selected>30 seconds</option>
              <option value="45">45 seconds</option>
              <option value="60">60 seconds</option>
            </select>
          </div>
          <div class="field">
            <label for="randomCount">Number of clips</label>
            <select id="randomCount" class="effect-select">
              <option value="1">1 clip</option>
              <option value="3" selected>3 clips</option>
              <option value="5">5 clips</option>
              <option value="10">10 clips</option>
            </select>
          </div>
        </div>
        <p id="randomHint" class="import-note"></p>
        <p id="randomError" class="form-error hidden" role="alert"></p>
      </section>

      <section class="settings-panel" id="settingsPanel">
        <div class="field">
          <label>Output format</label>
          <div class="format-options">
            <label><input type="radio" name="format" value="9:16" checked /> 9:16 Vertical (Shorts / Reels)</label>
            <label><input type="radio" name="format" value="1:1" /> 1:1 Square</label>
            <label><input type="radio" name="format" value="original" /> Original ratio</label>
          </div>
        </div>

        <div class="field" id="fitField">
          <label for="fitMode">Fit to frame</label>
          <select id="fitMode" class="effect-select">
            <option value="crop">Fill the frame (crops the edges)</option>
            <option value="pad">Fit whole picture (black bars)</option>
          </select>
          <p class="import-note">The picture is never stretched.</p>
        </div>

        <div class="field effect-field">
          <label for="effectSelect">Video effect</label>
          <select id="effectSelect" class="effect-select">
            <option value="normal">Original — no effect</option>
            <option value="cinematic">Cinematic Pro — teal & warm film grade</option>
            <option value="zoom">Dynamic Zoom — creator push-in</option>
            <option value="fade">Fade — smooth intro / outro</option>
            <option value="vibrant">Vibrant — bold social colour</option>
            <option value="warm">Golden Hour — warm glow</option>
            <option value="noir">Noir — dramatic black & white</option>
            <option value="retro">Retro Film — vintage grain</option>
            <option value="dreamy">Dreamy — soft glow</option>
            <option value="punch">Crisp Punch — sharp & vivid</option>
          </select>
          <p class="import-note" id="effectNote"></p>
        </div>
      </section>

      <div class="file-only manual-only">
        <button class="primary-btn" id="createClip" type="button">✦ Create my clip</button>
      </div>
      <div class="file-only random-only">
        <button class="primary-btn secondary-action" id="generateRandomClips" type="button">✦ Generate random clips</button>
      </div>

      <div class="progress-wrap hidden" id="progressWrap">
        <div class="progress-track"><div id="progressBar"></div></div>
        <p id="progressText">Preparing video...</p>
        <button class="mini-btn cancel-btn" id="cancelManual" type="button">Cancel</button>
      </div>

      <div class="random-panel-results file-only random-only">
        <div class="progress-wrap hidden" id="randomProgressWrap">
          <div class="progress-track"><div id="randomProgressBar"></div></div>
          <p id="randomProgressText">Preparing clips...</p>
          <button class="mini-btn cancel-btn" id="cancelRandom" type="button">Cancel</button>
        </div>
        <div class="random-actions hidden" id="randomActions">
          <button class="import-btn" id="downloadAllZip" type="button">↓ Download all as ZIP</button>
          <button class="import-btn secondary-btn" id="regenerateRandom" type="button">↻ Generate again</button>
        </div>
        <div id="randomResults" class="random-results"></div>
      </div>

      <section id="subtitlePanel" style="
        margin-top:28px;padding:22px;border:1px solid #34343d;
        border-radius:14px;background:#17171d;">
        <div style="margin-bottom:16px">
          <span class="step-label">WHISPER AI</span>
          <h2 style="margin:7px 0">Automatic subtitles</h2>
          <p style="color:#aaa;font-size:14px">
            Generate subtitles from the speech in your uploaded video.
          </p>
        </div>

        <button id="generateSubtitles" class="primary-btn" style="width:100%">
          ✦ Generate AI subtitles
        </button>

        <div id="aiProgress" style="display:none;margin-top:15px">
          <div class="progress-track"><div id="aiProgressBar"></div></div>
          <p id="aiProgressText" style="color:#aaa;margin-top:8px;font-size:13px">
            Preparing AI...
          </p>
        </div>

        <div id="subtitleEditor" style="display:none;margin-top:20px">
          <h3 style="margin-bottom:12px">Edit your subtitles</h3>
          <div id="subtitleList"></div>
          <button id="downloadSrt" class="download-btn" style="
            display:inline-block;margin-top:15px;border:0;cursor:pointer;">
            ↓ Download subtitles (SRT)
          </button>
        </div>
      </section>

      <div class="result hidden" id="result">
        <h3>✓ Your clip is ready!</h3>
        <video id="resultPreview" controls playsinline></video>
        <p class="import-note" id="resultInfo"></p>
        <a id="downloadBtn" class="download-btn" download="clipforge-short.mp4">
          ↓ Download MP4
        </a>
      </div>
    </div>
  </section>

  <section class="features" id="features">
    <div class="section-heading">
      <div><span class="step-label">WHY CLIPFORGE?</span><h2>Everything you need</h2></div>
    </div>
    <div class="feature-grid">
      <article class="feature-card"><span>✂</span><h3>Easy clipping</h3><p>Select the exact moments you want to turn into Shorts.</p></article>
      <article class="feature-card"><span>▯</span><h3>Vertical video</h3><p>Convert videos into a vertical 9:16 format.</p></article>
      <article class="feature-card"><span>✦</span><h3>AI subtitles</h3><p>Generate subtitles automatically using Whisper AI.</p></article>
    </div>
  </section>
</main>

<footer>
  <a class="brand" href="#">✂ ClipForge <span>AI</span></a>
  <p>Free video creation for everyone.</p>
  <p>© 2026 ClipForge AI</p>
</footer>
`;

const $ = selector => document.querySelector(selector);

const videoInput = $('#videoInput');
const videoPreview = $('#videoPreview');
const youtubePreview = $('#youtubePreview');
const workspace = $('#workspace');
const uploadArea = $('#uploadArea');
const createClipButton = $('#createClip');
const generateRandomButton = $('#generateRandomClips');
const startInput = $('#startTime');
const endInput = $('#endTime');

let sourceFile = null;
let sourceUrl = null;
let sourceReady = false;      // true once the browser has read the duration and size
let resultUrl = null;
let ytVideoId = null;
let ffmpeg = null;
let ffmpegLoaded = false;
let ffmpegLoading = null;
let transcriber = null;
let subtitles = [];
let processing = false;
let transcribing = false;
let cancelRequested = false;
let activeProgress = null;
let importController = null;
let randomClips = [];
const ffLog = [];

function setStatus(message) {
  $('#status').textContent = message;
}

let notifyPermissionReady = false;
$('#notifyWhenDone').addEventListener('change', async event => {
  if (!event.target.checked) return;
  if (!('Notification' in window)) {
    event.target.checked = false;
    alert('Desktop notifications are not supported by this browser.');
    return;
  }
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  notifyPermissionReady = permission === 'granted';
  if (!notifyPermissionReady) {
    event.target.checked = false;
    alert('Please allow notifications in your browser to use this option.');
  }
});

function notifyFinished(title, body) {
  if (!notifyPermissionReady || !$('#notifyWhenDone').checked || document.visibilityState === 'visible') return;
  try { new Notification(title, { body, icon: '/favicon.svg' }); } catch {}
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv', '3gp'];

function fileExtension(name) {
  return (String(name).split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
}

function looksLikeVideo(file) {
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.includes(fileExtension(file.name));
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function showMessage(element, message) {
  element.textContent = message || '';
  element.classList.toggle('hidden', !message);
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// ---------------------------------------------------------------------------
// Control state
// ---------------------------------------------------------------------------

function updateControls() {
  const importing = Boolean(importController);
  createClipButton.disabled = processing || !sourceReady;
  generateRandomButton.disabled = processing || !sourceReady;
  $('#regenerateRandom').disabled = processing || !sourceReady;
  $('#downloadAllZip').disabled = processing || !randomClips.length;
  $('#previewSegment').disabled = !sourceReady;
  $('#previewYoutube').disabled = processing || importing;
  const ytExport = $('#exportYoutubeClip');
  if (ytExport) ytExport.disabled = processing || workspace.dataset.source !== 'youtube';
  $('#importDirect').disabled = processing;
  $('#importDirect').textContent = importing ? 'Cancel' : 'Import';
  videoInput.disabled = processing || importing;
  uploadArea.classList.toggle('disabled', processing || importing);
}

function switchTab(name) {
  document.querySelectorAll('.import-tab').forEach(item => item.classList.toggle('active', item.dataset.tab === name));
  document.querySelectorAll('.import-content').forEach(item => item.classList.add('hidden'));
  $(`#${name}Tab`).classList.remove('hidden');
}


function setStudioTool(tool) {
  workspace.dataset.tool = tool;
  document.querySelectorAll('.studio-tab').forEach(button => {
    const active = button.dataset.tool === tool;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}
document.querySelectorAll('.studio-tab').forEach(button =>
  button.addEventListener('click', () => setStudioTool(button.dataset.tool))
);

function setMode(mode) {
  workspace.dataset.mode = mode;
  document.querySelectorAll('.mode-tab').forEach(item => {
    const active = item.dataset.mode === mode;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
}

// ---------------------------------------------------------------------------
// Loading a video (Upload and Video URL both end up here)
// ---------------------------------------------------------------------------

function clearResult() {
  $('#result').classList.add('hidden');
  $('#resultPreview').removeAttribute('src');
  $('#resultPreview').load();
  $('#downloadBtn').removeAttribute('href');
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
}

function clearRandomClips() {
  for (const clip of randomClips) URL.revokeObjectURL(clip.url);
  randomClips = [];
  $('#randomResults').innerHTML = '';
  $('#randomActions').classList.add('hidden');
  $('#randomProgressWrap').classList.add('hidden');
}

function activateVideoFile(file, kind = 'upload') {
  if (processing) {
    alert('Please wait for the current export to finish (or cancel it) before loading another video.');
    return;
  }

  if (!file || !looksLikeVideo(file)) {
    alert('Please select a valid video file.');
    return;
  }

  if (file.size > MAX_SOURCE_BYTES) {
    alert('Please choose a video smaller than 500 MB.');
    return;
  }

  stopRangePlayback();
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  clearResult();
  clearRandomClips();
  showMessage($('#randomError'), '');
  showMessage($('#clipError'), '');

  sourceFile = file;
  sourceUrl = URL.createObjectURL(file);
  sourceReady = false;
  ytVideoId = null;
  subtitles = [];

  $('#subtitleEditor').style.display = 'none';
  $('#aiProgress').style.display = 'none';

  youtubePreview.src = 'about:blank';
  youtubePreview.classList.add('hidden');
  videoPreview.classList.remove('hidden');
  workspace.dataset.source = 'file';

  videoPreview.src = sourceUrl;
  workspace.classList.remove('hidden');
  uploadArea.classList.add('compact');

  $('#fileName').textContent = file.name;
  $('#durationLabel').textContent = 'Loading video...';
  $('#progressWrap').classList.add('hidden');
  $('#sourceNote').classList.toggle('hidden', file.size <= WARN_SOURCE_BYTES);
  $('#sourceNote').textContent = file.size > WARN_SOURCE_BYTES
    ? `Large file (${formatBytes(file.size)}). Browser processing may be slow or run out of memory; shorter clips from a smaller file work best.`
    : '';
  updateControls();

  setStatus(kind === 'url' ? 'Video imported; preparing preview...' : 'Video loaded; preparing preview...');
}

function finishSourceSetup({ preserveRange = false } = {}) {
  const duration = videoPreview.duration;
  sourceReady = true;

  $('#durationLabel').textContent =
    `${formatClock(duration)} · ${videoPreview.videoWidth}×${videoPreview.videoHeight}`;
  if (!preserveRange) {
    startInput.value = formatClock(0);
    endInput.value = formatClock(Math.min(15, Math.floor(duration * 10) / 10));
  }

  refreshClipSummary();
  updateRandomHint();
  updateControls();
  if (workspace.dataset.source === 'youtube-file') {
    $('#ytSourceStatus').textContent = `Source ready (${formatClock(duration)}). Your YouTube start/end timestamps are retained. Click Create my clip to export this segment as MP4.`;
    setStatus('YouTube segment ready for MP4 export');
  } else {
    setStatus('Video ready to edit');
  }
}

function sourceFailed() {
  if (!sourceFile || !['file', 'youtube-file'].includes(workspace.dataset.source)) return;
  sourceReady = false;
  $('#durationLabel').textContent = 'Cannot read this video';
  updateControls();
  setStatus('Video could not be loaded');
  alert(
    'Your browser could not read this video (unsupported format or codec, or a damaged file). ' +
    'Try an H.264 MP4 or a WebM file.'
  );
}

videoPreview.addEventListener('loadedmetadata', () => {
  if (!sourceFile || !['file', 'youtube-file'].includes(workspace.dataset.source)) return;
  const duration = videoPreview.duration;

  if (duration === Infinity) {
    // Some WebM files report an unknown length until the end is reached.
    const resolve = () => {
      if (!Number.isFinite(videoPreview.duration)) return;
      videoPreview.removeEventListener('durationchange', resolve);
      videoPreview.currentTime = 0;
      finishSourceSetup({ preserveRange: workspace.dataset.source === 'youtube-file' });
    };
    videoPreview.addEventListener('durationchange', resolve);
    videoPreview.currentTime = 1e7;
    return;
  }

  if (!Number.isFinite(duration) || duration <= 0 || !videoPreview.videoWidth) {
    sourceFailed();
    return;
  }
  finishSourceSetup({ preserveRange: workspace.dataset.source === 'youtube-file' });
});

videoPreview.addEventListener('error', sourceFailed);

videoInput.addEventListener('change', () => {
  const file = videoInput.files[0];
  videoInput.value = '';
  activateVideoFile(file, 'upload');
});

document.querySelectorAll('.import-tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

uploadArea.addEventListener('dragover', event => {
  event.preventDefault();
  if (!processing && !importController) uploadArea.classList.add('dragging');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragging');
});

uploadArea.addEventListener('drop', event => {
  event.preventDefault();
  uploadArea.classList.remove('dragging');
  if (processing || importController) return;

  const file = event.dataTransfer.files[0];
  if (file) activateVideoFile(file, 'upload');
});

// ---------------------------------------------------------------------------
// Video URL import (direct media files only)
// ---------------------------------------------------------------------------

class ImportError extends Error {}

const URL_TYPE_TO_EXT = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/ogg': 'ogv',
  'video/x-matroska': 'mkv'
};
const EXT_TO_MIME = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v',
  ogv: 'video/ogg', mkv: 'video/x-matroska', avi: 'video/x-msvideo', '3gp': 'video/3gpp'
};

async function importFromUrl() {
  if (importController) {            // the button turns into "Cancel" while downloading
    importController.abort();
    return;
  }
  if (processing) return;

  const message = $('#importMessage');
  const raw = $('#directUrl').value.trim();
  if (!raw) return showMessage(message, 'Please paste a video URL.');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return showMessage(message, 'That is not a valid URL. Include https:// at the start.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return showMessage(message, 'Only HTTP and HTTPS URLs are supported.');
  }
  if (getYouTubeId(raw) || /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(parsed.hostname)) {
    return showMessage(message, 'That is a YouTube page, not a direct video file. Use the YouTube tab for a preview and timestamped link, or upload a video file you are authorised to edit.');
  }
  if (location.protocol === 'https:' && parsed.protocol === 'http:') {
    return showMessage(message, 'This site is served over HTTPS, so the browser blocks plain http:// video links. Use an https:// link.');
  }

  const controller = new AbortController();
  importController = controller;
  updateControls();
  showMessage(message, 'Connecting...');
  setStatus('Downloading source video...');

  try {
    let response;
    try {
      response = await fetch(raw, { signal: controller.signal, credentials: 'omit' });
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new ImportError(
        'Could not download this URL. The most common reason is that the host does not allow browser access (CORS), ' +
        'or the link is offline. ClipForge cannot bypass this. Download the file yourself and use Upload Video instead.'
      );
    }

    if (!response.ok) {
      throw new ImportError(`The server answered ${response.status} ${response.statusText}. Check that the link is public and still works.`);
    }

    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const allowedOther = ['', 'application/octet-stream', 'binary/octet-stream', 'application/mp4'];
    if (!type.startsWith('video/') && !allowedOther.includes(type)) {
      throw new ImportError(`This URL returned "${type}", which is not a video file. Paste a direct link that ends in a file such as .mp4 or .webm, not a webpage.`);
    }

    const pathExtension = parsed.pathname.split('.').pop().toLowerCase();
    const extension = URL_TYPE_TO_EXT[type] || (VIDEO_EXTENSIONS.includes(pathExtension) ? pathExtension : null);
    if (!extension) {
      throw new ImportError('Could not recognise this link as a video file. Use a direct link to an .mp4 or .webm file.');
    }

    const expected = Number(response.headers.get('content-length')) || 0;
    if (expected > MAX_SOURCE_BYTES) {
      throw new ImportError(`This file is ${formatBytes(expected)}. Please use a video smaller than 500 MB.`);
    }

    const chunks = [];
    let received = 0;
    const report = () => {
      const part = expected ? ` of ${formatBytes(expected)} (${Math.round(received / expected * 100)}%)` : '';
      showMessage(message, `Downloading ${formatBytes(received)}${part}...`);
    };

    if (response.body?.getReader) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (received > MAX_SOURCE_BYTES) {
          controller.abort();
          throw new ImportError('This file is larger than 500 MB. Please use a smaller video.');
        }
        report();
      }
    } else {
      const blob = await response.blob();
      chunks.push(blob);
      received = blob.size;
    }

    if (!received) throw new ImportError('The video URL returned an empty file.');

    const lastSegment = decodeURIComponent(parsed.pathname.split('/').pop() || '');
    const cleanName = lastSegment.replace(/[^\w.\- ]+/g, '_');
    const fileName = cleanName && cleanName.includes('.') ? cleanName : `imported-video.${extension}`;
    const mime = type.startsWith('video/') ? type : (EXT_TO_MIME[extension] || 'video/mp4');

    showMessage(message, `Downloaded ${formatBytes(received)}. Loading preview...`);
    activateVideoFile(new File(chunks, fileName, { type: mime }), 'url');
    showMessage(message, '');
  } catch (error) {
    if (error instanceof ImportError) {
      showMessage(message, error.message);
      setStatus('URL import failed');
    } else if (controller.signal.aborted) {
      showMessage(message, 'Import cancelled.');
      setStatus('Import cancelled');
    } else {
      console.error(error);
      showMessage(message, `Import failed: ${error.message || error}`);
      setStatus('URL import failed');
    }
  } finally {
    importController = null;
    updateControls();
  }
}

$('#importDirect').addEventListener('click', importFromUrl);

// ---------------------------------------------------------------------------
// Manual clip: timestamps, validation, segment preview
// ---------------------------------------------------------------------------

function currentDuration() {
  if (workspace.dataset.source === 'youtube' && !sourceFile) return null;   // Embedded player does not expose a downloadable media file
  return sourceReady ? videoPreview.duration : NaN;
}

function readRange(forExport) {
  if (['file', 'youtube-file'].includes(workspace.dataset.source) && !sourceReady) {
    return { ok: false, error: 'The video is still loading.' };
  }
  return validateRange(startInput.value, endInput.value, currentDuration(),
    forExport ? { maxLength: MAX_MANUAL_CLIP_SECONDS } : {});
}

function refreshClipSummary() {
  const range = readRange(['file', 'youtube-file'].includes(workspace.dataset.source));
  const summary = $('#clipSummary');
  if (range.ok) {
    summary.textContent = `Selected: ${formatClock(range.start)} → ${formatClock(range.end)} · length ${range.length.toFixed(1)} s`;
    summary.classList.remove('bad');
    showMessage($('#clipError'), '');
  } else {
    summary.textContent = '';
    showMessage($('#clipError'), range.error);
  }
  updateYoutubeLink();
}

startInput.addEventListener('input', refreshClipSummary);
endInput.addEventListener('input', refreshClipSummary);

$('#setStartNow').addEventListener('click', () => {
  startInput.value = formatClock(videoPreview.currentTime);
  refreshClipSummary();
});
$('#setEndNow').addEventListener('click', () => {
  endInput.value = formatClock(videoPreview.currentTime);
  refreshClipSummary();
});

let rangeEnd = null;
let rangeFrame = 0;

function stopRangePlayback() {
  rangeEnd = null;
  cancelAnimationFrame(rangeFrame);
}

function rangeTick() {
  if (rangeEnd === null) return;
  if (videoPreview.currentTime >= rangeEnd || videoPreview.ended) {
    videoPreview.pause();
    stopRangePlayback();
    return;
  }
  rangeFrame = requestAnimationFrame(rangeTick);
}

videoPreview.addEventListener('pause', stopRangePlayback);

$('#previewSegment').addEventListener('click', () => {
  const range = readRange(false);
  if (!range.ok) return showMessage($('#clipError'), range.error);
  stopRangePlayback();
  videoPreview.currentTime = range.start;
  rangeEnd = range.end;
  videoPreview.play().then(() => {
    rangeFrame = requestAnimationFrame(rangeTick);
  }).catch(error => {
    stopRangePlayback();
    console.warn('Segment preview could not start:', error);
  });
});

// ---------------------------------------------------------------------------
// Output settings
// ---------------------------------------------------------------------------

function readSettings() {
  return {
    format: $('input[name="format"]:checked').value,
    fit: $('#fitMode').value,
    effect: $('#effectSelect').value
  };
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://shortsnip-api.onrender.com').replace(/\/$/, '');

async function renderOnBackend({ start, end, settings, onProgress }) {
  if (!sourceFile) throw new Error('No source video is loaded.');
  const form = new FormData();
  form.append('video', sourceFile, sourceFile.name || 'source.mp4');
  form.append('start', String(start));
  form.append('end', String(end));
  form.append('format', settings.format);
  form.append('fit', settings.fit === 'pad' ? 'pad' : settings.fit === 'blur' ? 'blur' : 'crop');
  form.append('effect', settings.effect);

  onProgress?.(2, 'Getting your video ready… grab a drink while we prepare it.');
  const response = await fetch(`${API_BASE}/api/jobs`, { method: 'POST', body: form });
  const created = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(created.error || `Backend upload failed (${response.status}).`);
  if (!created.id) throw new Error('Backend did not return a processing job ID.');

  let job;
  while (true) {
    if (cancelRequested) throw new CancelledError('Processing cancelled.');
    await new Promise(resolve => setTimeout(resolve, 1200));
    const statusResponse = await fetch(`${API_BASE}/api/jobs/${encodeURIComponent(created.id)}`);
    job = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) throw new Error(job.error || 'Could not read processing status.');
    if (job.status === 'failed') throw new Error(job.error || 'Server-side FFmpeg processing failed.');
    if (job.status === 'completed') break;
    onProgress?.(job.progress || 5, job.status === 'queued' ? 'You’re in the queue. We’ll start shortly…' : 'Your clip is being created. Sit back and relax…');
  }

  onProgress?.(95, 'Putting the finishing touches on your video…');
  const fileResponse = await fetch(`${API_BASE}${job.downloadUrl}`);
  if (!fileResponse.ok) throw new Error('The MP4 was created, but download failed.');
  const blob = await fileResponse.blob();
  if (!blob.size) throw new Error('The server returned an empty MP4 file.');
  onProgress?.(100, 'Export complete.');
  return blob;
}

function describeSettings(settings) {
  const ratio = settings.format === 'original' ? 'original ratio' : settings.format;
  const effect = $('#effectSelect').selectedOptions[0]?.textContent.split(' — ')[0] || settings.effect;
  return `${ratio} · ${effect}`;
}

function refreshSettingsUi() {
  const settings = readSettings();
  $('#fitField').classList.toggle('hidden', settings.format === 'original');
  $('#effectNote').textContent = EFFECTS[settings.effect];
}

document.querySelectorAll('input[name="format"]').forEach(item => item.addEventListener('change', refreshSettingsUi));
$('#effectSelect').addEventListener('change', refreshSettingsUi);
refreshSettingsUi();

// ---------------------------------------------------------------------------
// YouTube (preview + timestamps + link only; no media download)
// ---------------------------------------------------------------------------

function updateYoutubeLink() {
  if (workspace.dataset.source !== 'youtube' || !ytVideoId) return;
  const start = parseTimestamp(startInput.value, 'Start time');
  $('#ytLinkOut').value = start.ok ? youtubeWatchLink(ytVideoId, start.seconds) : '';
}

function readYoutubeRange() {
  const range = readRange(false);
  if (!range.ok) {
    showMessage($('#clipError'), range.error);
    return null;
  }
  return range;
}

async function renderYoutubeOnBackend({ url, start, end, settings, onProgress }) {
  const response = await fetch(`${API_BASE}/api/youtube-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url, start, end, format: settings.format,
      fit: settings.fit === 'pad' ? 'pad' : settings.fit === 'blur' ? 'blur' : 'crop',
      effect: settings.effect,
      rightsConfirmed: $('#ytRightsConfirm').checked
    })
  });
  const created = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(created.error || `YouTube processing request failed (${response.status}).`);
  if (!created.id) throw new Error('Backend did not return a processing job ID.');
  let job;
  while (true) {
    if (cancelRequested) throw new CancelledError('Processing cancelled.');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const statusResponse = await fetch(`${API_BASE}/api/jobs/${encodeURIComponent(created.id)}`);
    job = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) throw new Error(job.error || 'Could not read YouTube processing status.');
    if (job.status === 'failed') throw new Error(job.error || 'YouTube processing failed.');
    if (job.status === 'completed') break;
    onProgress?.(job.progress || 5, 'Preparing your selected video section… this may take a few minutes.');
  }
  onProgress?.(95, 'Putting the finishing touches on your video…');
  const fileResponse = await fetch(`${API_BASE}${job.downloadUrl}`);
  if (!fileResponse.ok) throw new Error('The MP4 was created, but download failed.');
  const blob = await fileResponse.blob();
  if (!blob.size) throw new Error('The server returned an empty MP4 file.');
  onProgress?.(100, 'Export complete.');
  return blob;
}

$('#exportYoutubeClip').addEventListener('click', async () => {
  if (processing) return;
  if (workspace.dataset.source !== 'youtube' || !ytVideoId) return alert('Preview a YouTube URL first.');
  if (!$('#ytRightsConfirm').checked) return alert('Please confirm that you are authorised to download and edit this video.');
  const range = readYoutubeRange();
  if (!range) return;
  if (range.length > MAX_MANUAL_CLIP_SECONDS) return showMessage($('#clipError'), `Choose a clip no longer than ${MAX_MANUAL_CLIP_SECONDS} seconds.`);
  const url = $('#youtubeUrl').value.trim();
  const settings = readSettings();
  const progressText = $('#progressText');
  beginJob();
  clearResult();
  $('#progressWrap').classList.remove('hidden');
  $('#progressBar').style.width = '0%';
  progressText.textContent = 'Preparing YouTube clip...';
  $('#ytExportStatus').textContent = 'Submitting authorised media request...';
  setStatus('Processing YouTube clip...');
  try {
    const blob = await renderYoutubeOnBackend({
      url, start: range.start, end: range.end, settings,
      onProgress: (progress, message) => {
        $('#progressBar').style.width = `${Math.round(progress)}%`;
        progressText.textContent = message;
        $('#ytExportStatus').textContent = message;
      }
    });
    resultUrl = URL.createObjectURL(blob);
    $('#resultPreview').src = resultUrl;
    const download = $('#downloadBtn');
    download.href = resultUrl;
    download.download = `clipforge-youtube-${fileStamp(range.start)}-${fileStamp(range.end)}.mp4`;
    $('#resultInfo').textContent = `${formatClock(range.start)} → ${formatClock(range.end)} · ${range.length.toFixed(1)} s · ${describeSettings(settings)} · ${formatBytes(blob.size)}`;
    $('#result').classList.remove('hidden');
    $('#progressWrap').classList.add('hidden');
    $('#ytExportStatus').textContent = 'MP4 clip ready.';
    setStatus('YouTube clip ready!');
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    handleJobError(error, progressText);
    $('#ytExportStatus').textContent = `Export failed: ${error.message || error}`;
  } finally {
    endJob();
  }
});

$('#previewYoutube').addEventListener('click', () => {
  const raw = $('#youtubeUrl').value.trim();
  const id = getYouTubeId(raw);
  if (!id) return alert('Please enter a valid YouTube video URL (youtube.com/watch?v=…, youtu.be/…, or a Shorts link).');
  if (processing) return;

  stopRangePlayback();
  videoPreview.pause();
  videoPreview.removeAttribute('src');
  videoPreview.load();
  videoPreview.classList.add('hidden');
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = null;
  sourceFile = null;
  sourceReady = false;
  ytVideoId = id;

  clearResult();
  clearRandomClips();
  workspace.dataset.source = 'youtube';
  setMode('manual');

  const start = getYouTubeStart(raw);
  startInput.value = formatClock(start);
  endInput.value = formatClock(start + 30);

  youtubePreview.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?rel=0`;
  youtubePreview.classList.remove('hidden');
  workspace.classList.remove('hidden');

  $('#fileName').textContent = `YouTube video (${id})`;
  $('#durationLabel').textContent = 'Preview only · length not available';
  $('#sourceNote').classList.add('hidden');
  showMessage($('#ytCopyMessage'), '');
  refreshClipSummary();
  updateControls();

  setStatus('YouTube preview ready. Select a segment and export.');
});

$('#previewYoutubeSegment').addEventListener('click', () => {
  if (!ytVideoId) return alert('Preview a YouTube video first.');
  const range = readYoutubeRange();
  if (!range) return;
  youtubePreview.src = youtubeEmbedLink(ytVideoId, range.start, range.end, true);
});

async function copyText(text, input) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    input.focus();
    input.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

async function copyYoutubeLink(kind) {
  if (!ytVideoId) return alert('Preview a YouTube video first.');
  const range = readYoutubeRange();
  if (!range) return;
  const text = kind === 'embed'
    ? youtubeEmbedLink(ytVideoId, range.start, range.end)
    : youtubeWatchLink(ytVideoId, range.start);
  const output = $('#ytLinkOut');
  output.value = text;
  const copied = await copyText(text, output);
  const message = copied
    ? (kind === 'embed'
      ? 'Copied. This embed link plays only your start–end segment. It is a link, not an MP4 file.'
      : 'Copied. This link starts at your start time. It is a link, not an MP4 file.')
    : 'Could not copy automatically. The link is selected above; press Ctrl+C.';
  showMessage($('#ytCopyMessage'), message);
  setStatus('YouTube link ready');
}

$('#copyYoutubeSegment').addEventListener('click', () => copyYoutubeLink('watch'));
$('#copyYoutubeEmbed').addEventListener('click', () => copyYoutubeLink('embed'));

$('#ytGoUpload').addEventListener('click', () => {
  switchTab('upload');
  document.querySelector('.import-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// YouTube-assisted export: use the YouTube URL for preview/timestamps and
// an authorised matching source file as the actual FFmpeg input.
$('#ytUploadSource').addEventListener('click', () => {
  if (!ytVideoId) return alert('Preview a YouTube URL first.');
  $('#youtubeSourceInput').click();
});

$('#youtubeSourceInput').addEventListener('change', () => {
  const file = $('#youtubeSourceInput').files?.[0];
  $('#youtubeSourceInput').value = '';
  if (!file) return;
  if (!looksLikeVideo(file)) return showMessage($('#ytSourceStatus'), 'Please choose a valid video file.');
  if (file.size > MAX_SOURCE_BYTES) return showMessage($('#ytSourceStatus'), 'Please choose a video smaller than 500 MB.');
  if (processing) return alert('Wait for the current export to finish first.');

  stopRangePlayback();
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  clearResult();
  clearRandomClips();
  sourceFile = file;
  sourceUrl = URL.createObjectURL(file);
  sourceReady = false;
  workspace.dataset.source = 'youtube-file';
  videoPreview.src = sourceUrl;
  videoPreview.classList.add('hidden');
  youtubePreview.classList.remove('hidden');
  $('#fileName').textContent = `YouTube source file: ${file.name}`;
  $('#durationLabel').textContent = 'Checking uploaded source...';
  $('#ytSourceStatus').textContent = 'Source uploaded. Checking duration so the selected YouTube timestamps can be validated...';
  updateControls();
  setStatus('Checking YouTube source file...');
});

// Convert video audio into mono 16 kHz audio for Whisper.
async function extractAudio(file) {
  const audioContext = new AudioContext();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer);

    const channels = [];
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      channels.push(decoded.getChannelData(channel));
    }

    const mono = new Float32Array(decoded.length);

    for (let i = 0; i < decoded.length; i++) {
      let total = 0;
      for (const channel of channels) total += channel[i];
      mono[i] = total / channels.length;
    }

    const targetRate = 16000;
    const outputLength = Math.floor(mono.length * targetRate / decoded.sampleRate);
    const resampled = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const position = i * decoded.sampleRate / targetRate;
      const left = Math.floor(position);
      const right = Math.min(left + 1, mono.length - 1);
      const fraction = position - left;
      resampled[i] = mono[left] * (1 - fraction) + mono[right] * fraction;
    }

    return resampled;
  } finally {
    await audioContext.close();
  }
}

// Initialize Whisper only when the user requests subtitles.
async function loadWhisper() {
  if (transcriber) return transcriber;

  $('#aiProgress').style.display = 'block';
  $('#aiProgressText').textContent = 'Setting up speech recognition. First-time setup may take a little longer…';

  transcriber = await pipeline(
    'automatic-speech-recognition',
    'onnx-community/whisper-tiny',
    {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: progress => {
        if (progress.status === 'progress' && progress.total) {
          const percent = Math.round(progress.progress || 0);
          $('#aiProgressBar').style.width = `${percent}%`;
          $('#aiProgressText').textContent =
            `Downloading AI model: ${percent}%`;
        } else if (progress.status === 'ready') {
          $('#aiProgressText').textContent = 'AI model ready.';
        }
      }
    }
  );

  return transcriber;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function renderSubtitles() {
  const list = $('#subtitleList');
  list.innerHTML = '';

  subtitles.forEach((item, index) => {
    const row = document.createElement('div');

    row.style.cssText =
      'display:grid;grid-template-columns:95px 1fr;gap:10px;margin:10px 0;align-items:center';

    const time = document.createElement('span');
    time.textContent = formatTime(item.start);
    time.style.cssText = 'font-size:12px;color:#aaa';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.text;
    input.style.cssText =
      'width:100%;padding:11px;border:1px solid #454550;border-radius:8px;background:#22222a;color:white';

    input.addEventListener('input', () => {
      subtitles[index].text = input.value;
    });

    row.append(time, input);
    list.appendChild(row);
  });

  $('#subtitleEditor').style.display = 'block';
}

function toSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function createSrt() {
  return subtitles.map((item, index) => {
    const end = item.end ?? item.start + 3;

    return `${index + 1}\n${toSrtTime(item.start)} --> ${toSrtTime(end)}\n${item.text.trim()}\n`;
  }).join('\n');
}

$('#generateSubtitles').addEventListener('click', async () => {
  if (transcribing) return;

  if (!sourceFile) {
    return alert('Upload a video with speech first.');
  }

  if (videoPreview.duration > 600) {
    return alert('For this first version, please use a video of 10 minutes or less.');
  }

  transcribing = true;
  $('#generateSubtitles').disabled = true;
  $('#aiProgress').style.display = 'block';
  $('#aiProgressBar').style.width = '0%';
  $('#aiProgressText').textContent = 'Getting the audio ready for subtitles…';

  try {
    setStatus('Generating AI subtitles...');

    const audio = await extractAudio(sourceFile);

    if (!audio.length) throw new Error('No usable audio was found.');

    const model = await loadWhisper();

    $('#aiProgressText').textContent = 'Listening carefully and creating your subtitles…';

    const output = await model(audio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5
    });

    const chunks = output.chunks || [];

    subtitles = chunks.map(chunk => ({
      start: Array.isArray(chunk.timestamp) ? chunk.timestamp[0] ?? 0 : 0,
      end: Array.isArray(chunk.timestamp) ? chunk.timestamp[1] ?? 0 : 0,
      text: (chunk.text || '').trim()
    })).filter(item => item.text);

    if (!subtitles.length && output.text?.trim()) {
      subtitles = [{
        start: 0,
        end: videoPreview.duration,
        text: output.text.trim()
      }];
    }

    if (!subtitles.length) {
      throw new Error('No speech was detected. Check that your video contains clear speech.');
    }

    renderSubtitles();

    $('#aiProgressBar').style.width = '100%';
    $('#aiProgressText').textContent =
      `Finished! Generated ${subtitles.length} subtitle segments.`;

    setStatus('AI subtitles ready');
    notifyFinished('ClipForge subtitles are ready', 'Your subtitles are ready to review and download.');

  } catch (error) {
    console.error('Whisper error:', error);

    $('#aiProgressText').textContent =
      `Could not generate subtitles: ${error.message || error}`;

    setStatus('Subtitle generation failed');

    alert(
      'AI subtitle generation failed. Check the browser console for details. ' +
      'Try a shorter video with clear speech.'
    );

  } finally {
    transcribing = false;
    $('#generateSubtitles').disabled = false;
  }
});

$('#downloadSrt').addEventListener('click', () => {
  if (!subtitles.length) return;

  const blob = new Blob([createSrt()], {
    type: 'text/plain;charset=utf-8'
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'clipforge-subtitles.srt';
  link.click();

  URL.revokeObjectURL(url);
});

// ---------------------------------------------------------------------------
// FFmpeg engine
// ---------------------------------------------------------------------------

class ExportError extends Error {}
class CancelledError extends Error {}

function throwIfCancelled() {
  if (cancelRequested) throw new CancelledError('Cancelled');
}

async function loadFFmpeg() {
  if (ffmpegLoaded && ffmpeg) return;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    setStatus('Loading video engine (first time only)...');

    const instance = new FFmpeg();
    instance.on('progress', ({ progress }) => {
      if (activeProgress && Number.isFinite(progress)) activeProgress(Math.min(1, Math.max(0, progress)));
    });
    instance.on('log', ({ message }) => {
      ffLog.push(message);
      if (ffLog.length > 400) ffLog.shift();
    });

    try {
      await instance.load({ coreURL, wasmURL });
    } catch (error) {
      console.error('FFmpeg failed to load:', error);
      throw new Error(
        'The video engine could not be started. Make sure vite.config.js is present, run "npm install" again, ' +
        'and use a current desktop Chrome or Edge. (' + (error.message || error) + ')'
      );
    }

    if (cancelRequested) {
      instance.terminate();
      throw new CancelledError('Cancelled');
    }
    ffmpeg = instance;
    ffmpegLoaded = true;
  })().finally(() => {
    ffmpegLoading = null;
  });

  return ffmpegLoading;
}

function resetEngine() {
  try {
    ffmpeg?.terminate();
  } catch {
    // The worker may already be gone.
  }
  ffmpeg = null;
  ffmpegLoaded = false;
}

function lastLogLines() {
  const important = ffLog.filter(line => /error|invalid|unable|no such|fail|not found|cannot|unrecognized/i.test(line));
  return important.slice(-3).join(' | ');
}

function describeError(error) {
  const text = String(error?.message || error);
  if (/memory|out of bounds|allocation|abort|RuntimeError/i.test(text)) {
    return 'The browser ran out of memory while processing. Try a shorter clip, a smaller source file, or close other tabs, then try again.';
  }
  return text;
}

async function probeAudio(inputName) {
  ffLog.length = 0;
  try {
    await ffmpeg.exec(['-hide_banner', '-i', inputName]);   // exits non-zero by design; we only read the log
  } catch (error) {
    if (cancelRequested) throw error;
  }
  const text = ffLog.join('\n');
  if (!/Input #0/.test(text)) return null;                  // could not read the log: audio is still kept, just not faded
  return /Stream #\d+:\d+[^\n]*: Audio/.test(text);
}

async function stageSource() {
  await loadFFmpeg();
  throwIfCancelled();
  const inputName = `input.${fileExtension(sourceFile.name)}`;
  await ffmpeg.writeFile(inputName, await fetchFile(sourceFile));
  throwIfCancelled();
  const hasAudio = await probeAudio(inputName);
  return { inputName, hasAudio };
}

async function cleanupFiles(names) {
  for (const name of names) {
    try {
      await ffmpeg?.deleteFile(name);
    } catch {
      // The file may not exist if processing failed early.
    }
  }
}

async function renderClip({ inputName, hasAudio, outputName, start, duration, settings }) {
  const args = makeExportArgs({
    inputName,
    outputName,
    start,
    duration,
    format: settings.format,
    fit: settings.fit,
    effect: settings.effect,
    srcW: videoPreview.videoWidth,
    srcH: videoPreview.videoHeight,
    hasAudio
  });

  ffLog.length = 0;
  const exitCode = await ffmpeg.exec(args);
  throwIfCancelled();
  if (exitCode !== 0) {
    const detail = lastLogLines();
    throw new ExportError(
      `FFmpeg could not export this clip with the "${settings.effect}" effect (exit code ${exitCode}).` +
      (detail ? ` Details: ${detail}` : '') +
      ' Nothing was exported.'
    );
  }

  const data = await ffmpeg.readFile(outputName);
  try {
    await ffmpeg.deleteFile(outputName);
  } catch {
    // Already removed.
  }
  if (!data || !data.length) throw new ExportError('FFmpeg produced an empty file. Nothing was exported.');
  return new Blob([data], { type: 'video/mp4' });
}

function beginJob() {
  processing = true;
  cancelRequested = false;
  updateControls();
}

function endJob() {
  processing = false;
  activeProgress = null;
  updateControls();
}

function handleJobError(error, progressText) {
  if (cancelRequested || error instanceof CancelledError) {
    setStatus('Cancelled');
    progressText.textContent = 'Cancelled.';
    return;
  }
  console.error('ClipForge processing error:', error);
  if (!(error instanceof ExportError)) resetEngine();    // after a crash the engine must be rebuilt
  const message = describeError(error);
  setStatus('Processing failed');
  progressText.textContent = `Processing failed: ${message}`;
  alert(`Video processing failed: ${message}`);
}

function cancelJob() {
  if (!processing) return;
  cancelRequested = true;
  setStatus('Cancelling...');
  resetEngine();    // terminating the worker is the only way to stop a running FFmpeg job
}

$('#cancelManual').addEventListener('click', cancelJob);
$('#cancelRandom').addEventListener('click', cancelJob);

// ---------------------------------------------------------------------------
// Manual export
// ---------------------------------------------------------------------------

createClipButton.addEventListener('click', async () => {
  if (processing) return;
  if (!sourceFile || !sourceReady) return showMessage($('#clipError'), 'Load a video first.');

  const range = readRange(true);
  if (!range.ok) return showMessage($('#clipError'), range.error);
  showMessage($('#clipError'), '');

  const settings = readSettings();
  const progressText = $('#progressText');
  const outputName = 'clipforge-output.mp4';
  let staged = null;

  beginJob();
  clearResult();
  $('#progressWrap').classList.remove('hidden');
  $('#progressBar').style.width = '0%';
  progressText.textContent = 'Your video is getting ready…';
  setStatus('Processing video...');

  try {
    const blob = await renderOnBackend({
      start: range.start,
      end: range.end,
      settings,
      onProgress: (progress, message) => {
        $('#progressBar').style.width = `${Math.round(progress)}%`;
        progressText.textContent = message;
      }
    });

    resultUrl = URL.createObjectURL(blob);
    $('#resultPreview').src = resultUrl;
    const download = $('#downloadBtn');
    download.href = resultUrl;
    download.download = `clipforge-${fileStamp(range.start)}-${fileStamp(range.end)}-${settings.effect}.mp4`;
    $('#resultInfo').textContent =
      `${formatClock(range.start)} → ${formatClock(range.end)} · ${range.length.toFixed(1)} s · ${describeSettings(settings)} · ${formatBytes(blob.size)}`;

    $('#result').classList.remove('hidden');
    $('#progressWrap').classList.add('hidden');
    setStatus('Clip ready!');
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    handleJobError(error, progressText);
  } finally {
    await cleanupFiles([staged?.inputName, outputName].filter(Boolean));
    endJob();
  }
});

$('#resultPreview').addEventListener('error', () => {
  if ($('#resultPreview').getAttribute('src')) {
    alert('The exported file could not be played back by this browser. Try the Normal effect or a shorter clip.');
  }
});

// ---------------------------------------------------------------------------
// Random clip generator (randomly chosen sections - NOT AI highlights)
// ---------------------------------------------------------------------------

function updateRandomHint() {
  const hint = $('#randomHint');
  if (!sourceReady) {
    hint.textContent = '';
    return;
  }
  const duration = Number($('#randomDuration').value);
  const count = Number($('#randomCount').value);
  const total = videoPreview.duration;
  if (total < duration) {
    hint.textContent = `This video is ${formatClock(total)} long, shorter than ${duration} seconds. Choose a shorter clip duration.`;
    return;
  }
  const fits = Math.floor(total / duration + 1e-9);
  hint.textContent = fits >= count
    ? `Video length ${formatClock(total)}: ${count} non-overlapping ${duration}-second clip(s) will fit.`
    : `Video length ${formatClock(total)}: only ${fits} non-overlapping ${duration}-second clip(s) fit, so at most ${fits} will be generated.`;
}

$('#randomDuration').addEventListener('change', updateRandomHint);
$('#randomCount').addEventListener('change', updateRandomHint);

function createRandomCard(index, start, end) {
  const card = document.createElement('article');
  card.className = 'random-result-card';

  const heading = document.createElement('h3');
  heading.textContent = `Clip ${index + 1} · ${formatClock(start)} – ${formatClock(end)}`;

  const state = document.createElement('p');
  state.className = 'import-note';
  state.textContent = 'Waiting...';

  card.append(heading, state);
  $('#randomResults').appendChild(card);
  return { card, state };
}

async function generateRandomClips() {
  if (processing) return;
  if (!sourceFile || !sourceReady) return showMessage($('#randomError'), 'Load a video first.');

  const duration = Number($('#randomDuration').value);
  const count = Number($('#randomCount').value);
  const plan = planRandomClips(videoPreview.duration, duration, count);

  if (!plan.ok) {
    showMessage($('#randomError'), plan.error);
    return;
  }
  showMessage($('#randomError'), '');

  const settings = readSettings();
  const progressText = $('#randomProgressText');
  const total = plan.clips.length;
  const cards = [];
  const outputNames = [];
  let staged = null;

  clearRandomClips();
  plan.clips.forEach((clip, index) => cards.push(createRandomCard(index, clip.start, clip.end)));

  beginJob();
  $('#randomProgressWrap').classList.remove('hidden');
  $('#randomProgressBar').style.width = '0%';
  progressText.textContent = plan.reduced
    ? `Only ${total} non-overlapping clip(s) fit in this video, so ${total} will be generated.`
    : `Preparing ${total} random clip(s)...`;
  setStatus('Generating random clips...');

  let current = 0;
  try {
    for (; current < total; current++) {
      throwIfCancelled();
      const { start, end } = plan.clips[current];
      const outputName = `clipforge-random-${current + 1}.mp4`;
      outputNames.push(outputName);

      cards[current].state.textContent = 'Rendering...';
      progressText.textContent = `Creating clip ${current + 1} of ${total}...`;
      activeProgress = progress => {
        const overall = (current + progress) / total;
        $('#randomProgressBar').style.width = `${Math.round(overall * 100)}%`;
      };

      const blob = await renderOnBackend({
        start,
        end,
        settings,
        onProgress: (progress, message) => {
          const overall = (current + progress / 100) / total;
          $('#randomProgressBar').style.width = `${Math.round(overall * 100)}%`;
          progressText.textContent = `Clip ${current + 1}/${total}: ${message}`;
        }
      });

      const url = URL.createObjectURL(blob);
      const fileName = `clipforge-random-${String(current + 1).padStart(2, '0')}_${fileStamp(start)}-${fileStamp(end)}.mp4`;
      randomClips.push({ index: current, start, end, blob, url, fileName });

      const { card, state } = cards[current];
      const preview = document.createElement('video');
      preview.controls = true;
      preview.playsInline = true;
      preview.src = url;
      const link = document.createElement('a');
      link.className = 'download-btn';
      link.href = url;
      link.download = fileName;
      link.textContent = `↓ Download this clip (${formatBytes(blob.size)})`;
      state.replaceWith(preview);
      card.append(link);

      $('#randomProgressBar').style.width = `${Math.round(((current + 1) / total) * 100)}%`;
    }

    progressText.textContent = `Finished! ${total} clip(s) are ready. Preview and download the ones you like.`;
    setStatus('Random clips ready');
    notifyFinished('Your random clips are ready', 'Your clips have finished processing. Return to ClipForge to preview and download them.');
  } catch (error) {
    // Keep the clips that finished; mark or remove the rest.
    for (let i = current; i < cards.length; i++) {
      if (cancelRequested || error instanceof CancelledError) cards[i].card.remove();
      else if (i === current) cards[i].state.textContent = 'Failed.';
      else cards[i].card.remove();
    }
    handleJobError(error, progressText);
    if (randomClips.length) progressText.textContent += ` ${randomClips.length} clip(s) finished before this and are still available.`;
  } finally {
    await cleanupFiles([staged?.inputName, ...outputNames].filter(Boolean));
    endJob();
    $('#randomActions').classList.toggle('hidden', !randomClips.length);
    updateControls();
  }
}

generateRandomButton.addEventListener('click', generateRandomClips);
$('#regenerateRandom').addEventListener('click', generateRandomClips);

$('#downloadAllZip').addEventListener('click', async () => {
  if (!randomClips.length || processing) return;
  const button = $('#downloadAllZip');
  button.disabled = true;
  try {
    const files = [];
    for (const clip of randomClips) {
      files.push({ name: clip.fileName, data: new Uint8Array(await clip.blob.arrayBuffer()) });
    }
    downloadBlob(createZip(files), 'clipforge-random-clips.zip');
    setStatus('ZIP downloaded');
  } catch (error) {
    console.error('ZIP creation failed:', error);
    alert(`Could not create the ZIP: ${error.message || error}. You can still download the clips one by one.`);
  } finally {
    updateControls();
  }
});

window.addEventListener('beforeunload', () => {
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  for (const clip of randomClips) URL.revokeObjectURL(clip.url);
});

updateControls();
