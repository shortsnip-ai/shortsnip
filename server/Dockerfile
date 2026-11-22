# Snipshort / ClipForge processing API
# Node.js 22 + FFmpeg + FFprobe + yt-dlp in one reproducible image.
FROM node:22-bookworm-slim

# yt-dlp release to install. 2026.10.26 is the version used in the local test
# on 20 Nov 2026. To change it, edit this line (or pass --build-arg).
ARG YTDLP_VERSION=2026.10.26

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Standalone yt-dlp binary (does not need Python).
RUN curl -fsSL -o /usr/local/bin/yt-dlp \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux" \
 && chmod 755 /usr/local/bin/yt-dlp

# Current yt-dlp needs a JavaScript runtime to read YouTube pages; Node.js 22 is
# already in this image. This only tells yt-dlp to use it. It does not change
# how requests are made and does not address YouTube's bot checks.
RUN printf -- '--js-runtimes node\n' > /etc/yt-dlp.conf

# Fail the build early if any required program does not run.
RUN ffmpeg -version | head -n 1 \
 && ffprobe -version | head -n 1 \
 && yt-dlp --version

ENV NODE_ENV=production \
    WORK_DIR=/tmp/clipforge-jobs \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe \
    YTDLP_PATH=yt-dlp

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js jobTools.js ./

# Render sets PORT itself (the server reads process.env.PORT). 10000 is Render's default.
EXPOSE 10000
USER node
CMD ["node", "server.js"]
