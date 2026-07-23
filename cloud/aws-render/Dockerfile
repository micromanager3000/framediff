FROM mcr.microsoft.com/playwright:v1.61.1-noble

ARG FRAMEDIFF_REVISION=unknown
LABEL org.opencontainers.image.title="FrameDiff AWS GPU render worker" \
      org.opencontainers.image.revision="${FRAMEDIFF_REVISION}"

ENV DEBIAN_FRONTEND=noninteractive \
    FD_CHROME_PATH=/usr/bin/google-chrome \
    FD_WORKSPACE=/workspace \
    NODE_ENV=production

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg gnupg jq \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages ./packages
COPY examples/determinism-check ./examples/determinism-check
COPY examples/cloth-showcase ./examples/cloth-showcase
COPY cloud/aws-render ./cloud/aws-render

RUN npm ci --ignore-scripts \
    && npm --prefix cloud/aws-render ci --omit=dev \
    && mkdir -p cloud/aws-render/harness/public/fixtures \
    && ffmpeg -hide_banner -loglevel error -y \
      -f lavfi -i "testsrc2=size=640x360:rate=30:duration=2" \
      -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" \
      -c:v libx264 -pix_fmt yuv420p -preset veryfast -g 30 \
      -c:a aac -b:a 128k -shortest \
      cloud/aws-render/harness/public/fixtures/synthetic.mp4 \
    && ffmpeg -hide_banner -loglevel error -y \
      -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=2" \
      -c:a pcm_s16le \
      cloud/aws-render/harness/public/fixtures/synthetic.wav

WORKDIR /workspace/cloud/aws-render
ENTRYPOINT ["node", "src/run-job.mjs"]
