FROM ubuntu:24.04 AS fixtures

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && mkdir -p /fixtures \
    && ffmpeg -hide_banner -loglevel error -y \
      -f lavfi -i "testsrc2=size=640x360:rate=30:duration=2" \
      -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" \
      -c:v libx264 -pix_fmt yuv420p -preset veryfast -g 30 \
      -c:a aac -b:a 128k -shortest \
      /fixtures/synthetic.mp4 \
    && ffmpeg -hide_banner -loglevel error -y \
      -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=2" \
      -c:a pcm_s16le \
      /fixtures/synthetic.wav

FROM mcr.microsoft.com/playwright:v1.61.1-noble

ARG FRAMEDIFF_REVISION=unknown
LABEL org.opencontainers.image.title="FrameDiff AWS GPU render worker" \
      org.opencontainers.image.revision="${FRAMEDIFF_REVISION}"

ENV DEBIAN_FRONTEND=noninteractive \
    FD_CHROME_PATH=/usr/bin/google-chrome \
    FD_WORKSPACE=/workspace \
    NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && apt-get purge -y \
      curl \
      gnupg \
      gnupg-utils \
      gpg \
      gpg-agent \
      gpgconf \
      gpgsm \
      keyboxd \
      gstreamer1.0-libav \
      libavcodec60 \
      libavfilter9 \
      libavformat60 \
      libavutil58 \
      libcjson1 \
      libpostproc57 \
      librist4 \
      libswresample4 \
      libswscale7 \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY examples/determinism-check ./examples/determinism-check
COPY examples/cloth-showcase ./examples/cloth-showcase
COPY cloud/aws-render ./cloud/aws-render

RUN npm ci --ignore-scripts \
    && npm --prefix cloud/aws-render ci --omit=dev \
    && test -f cloud/aws-render/node_modules/vite/bin/vite.js \
    && test -f tsconfig.base.json \
    && mkdir -p cloud/aws-render/harness/public/fixtures \
    && node cloud/aws-render/scripts/cache-models.mjs

COPY --from=fixtures /fixtures/ cloud/aws-render/harness/public/fixtures/

WORKDIR /workspace/cloud/aws-render
ENTRYPOINT ["node", "src/run-job.mjs"]
