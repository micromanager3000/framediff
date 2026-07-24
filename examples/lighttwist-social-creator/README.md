# LightTwist social · show-building creator

A 9.5-second, 1080×1920 LightTwist social ad aimed at video-podcast and YouTube
show hosts.

The story is a direct before/after:

1. **0–2.2s — pain:** a remote-call grid with “Your podcast still looks like a call?”
2. **1.9–7.4s — transformation:** three LightTwist newsroom angles with “Make it a
   show,” “Remote guests,” and “One branded studio.”
3. **7.2–9.5s — action:** a branded end card with `lighttwist.com`.

The project reuses selected media from `examples/hero-reel/assets` through
content-addressed `asset://` references. It does not duplicate or modify the source
LightTwist demo videos.

Run the Studio:

```bash
npm run dev --workspace @framediff/example-lighttwist-social-creator -- \
  --host 127.0.0.1 \
  --port 4181
```

The copy and audio levels are editable in
`src/compositions/CreatorSocial.comp.json`; timing and shot choice live in
`src/compositions/CreatorSocial.timeline.json`.
