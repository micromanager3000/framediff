# ElevenLabs direct, and two bugs found on the way

**2026-07-30.** Three fixes, discovered while building a five-minute narrated short
(`monsters-pizza`) against the engine as a **git dependency** rather than a workspace
example. That consumption path is the common thread: two of the three bugs are invisible to
`examples/*` and only appear once a project installs FrameDiff from GitHub.

| Commit | Change |
| --- | --- |
| `ed0672f` | `framediffDev()` excludes the engine from Vite's dep optimizer |
| `6f29707` | ElevenLabs added as a direct generation provider (TTS + Voice Design) |
| `01d272a` | ElevenLabs surfaced in the Services credentials panel |

---

## 1. The encode worker could not start in git-dependency projects

**Symptom.** Every composition-to-video bake failed instantly:

> `encode worker failed to start — reload the page; if it persists, ensure framediffDev() is enabled in Vite`

The message sent us to the wrong place: `framediffDev()` *was* enabled. Any recipe holding a
`comp://` video reference was blocked, because resolving that reference bakes the referenced
composition first.

**Cause.** `exportVideo` spawns its encoder with

```ts
new Worker(new URL("./encodeWorker.ts", import.meta.url), { type: "module" })
```

which resolves relative to the module's own location. A consuming project aliases
`framediff` into `node_modules/framediff-monorepo/packages/*`, so Vite's dependency
optimizer treats it as a bare dependency and prebundles it into `.vite/deps`. From inside a
prebundled chunk, `import.meta.url` points at the chunk — and `./encodeWorker.ts` beside it
does not exist. The worker 404s, posts no message, and the export rejects.

Workspace examples never hit this: linked workspace source is exempt from prebundling.

**Fix.** The plugin's `config()` now excludes every browser-consumable engine id, so the
engine is always served as raw source:

```ts
optimizeDeps: {
  include: ["mp4-muxer", "@babel/parser"],
  exclude: [
    "framediff", "framediff/three", "framediff/gsap", "framediff/gsap/source",
    "framediff/studio-runtime", "@framediff/studio-model", "@framediff/studio-ui",
  ],
}
```

`@babel/parser` is in `include` deliberately: it is the excluded source's one pure-CJS
dependency, and once the engine stops being prebundled it still needs esbuild interop.
Without it the app fails to boot with `does not provide an export named 'parse'` — so the
two halves of this fix must land together. The excludes are a no-op for workspace examples.

The worker-load error message now names this cause instead of pointing at plugin
registration.

---

## 2. ElevenLabs was reachable only through fal

**Symptom.** Casting four characters, we found the voice list was exactly ten presets —
Rachel, Aria, Sarah, Charlotte, Matilda, Laura, Jessica, Brian, Daniel, George — with only
three male voices and no child voice. Anything outside that list fails at submit with
`Voice not found`. There was also no `seed`, so a narration take could not request
ElevenLabs' best-effort repeatability.

**Cause.** Every ElevenLabs model in the registry was `vendor: "ElevenLabs · fal"`, routed
through fal's wrapper, which exposes a preset subset. `elevenlabs` existed in the plugin's
`KNOWN_PROVIDERS` and `PROVIDER_ENV`, but only as a **secret slot** — generation dispatch
was hard-limited to `fal | byteplus`, so a recipe with `"provider": "elevenlabs"` returned
`unsupported generation provider`.

**Fix.** `GenProvider` gains `"elevenlabs"`, and two models were added:

- **`elevenlabs-direct`** — TTS against `POST /v1/text-to-speech/{voice_id}`. Any voice id
  works, so the full library, cloned voices, and Voice Design output are all reachable,
  plus `voice_settings` and a real `seed`.
- **`elevenlabs-voice-design`** — `POST /v1/text-to-voice/design`. The prompt *is* the voice
  description; the response is a set of candidate voices.

### The synchronous path

fal and BytePlus both queue and poll: submit returns a job id, a later `GET /gen/jobs`
finds it complete and downloads the artifact. **ElevenLabs answers immediately** — audio
bytes for TTS, base64 previews for design. Rather than fake a queue, the bridge writes the
take to the CAS during submit and returns a job that is already `done` with its `assetId`.
The polling loop skips it because it is not `queued` or `running`.

### Voice Design maps onto takes

A design call returns several candidates, and the takes rail is already an audition UI, so
**each candidate becomes its own take** (take 1, take 2, take 3 from a single submit).
Every take records the `generated_voice_id` that produced it in its manifest `generator`
block. Pin the one you want, then promote it:

```
POST /__framediff/gen/voice/create   { generatedVoiceId, name, description }
  → { voice_id }                     # use this as `voice` on an elevenlabs-direct recipe
```

### Why there is no voice picker

`elevenlabs-direct` deliberately ships **no `voice` param**. Voice ids are account-specific,
so a static enum would be fiction — the same mistake that produced the `Voice not found`
failure in the first place. The id lives in the recipe JSON, and real ones are discoverable:

```
GET /__framediff/gen/voices → { voices: [{ voice_id, name, category, description }] }
```

A follow-up could let the Studio populate a picker from that route.

**Note:** ElevenLabs direct needs its own `ELEVENLABS_API_KEY`. A fal key will not work.

---

## 3. The new provider had no row in Services

**Symptom.** With the provider shipped, there was still no way to add its key from the
Studio. The bridge accepted an `elevenlabs` secret and `GET /__framediff/secrets` listed the
slot, but the Services panel showed only fal, Seedance direct, Midjourney, and Luma.

**Cause.** `getProviderCredentials()` builds a **hardcoded** catalog, and
`ProviderCredentialSnapshot["provider"]` is a closed union. Neither knew about
`elevenlabs`. (`replicate` is in `KNOWN_PROVIDERS` and likewise absent — a pre-existing
gap left alone here.)

**Fix.** An `integration: "active"` entry for ElevenLabs, and the union widened to include
it. Adding a provider therefore touches **three** places — the dispatch allowlist, the
model registry, and this catalog — which is worth remembering, or worth collapsing into one
source of truth.

---

## Verification

Full suite green after review: **514 tests across 75 files**, workspace typecheck and build
clean. Beyond routing
assertions, two bridge integration tests stub the provider and prove the behaviour that is easy to
get wrong:

- a TTS submit lands a finished take — status `done`, an `assetId`, `audio/mpeg` in the
  manifest, and the `xi-api-key` header on the request;
- a three-preview design submit produces three takes numbered 1–3, each carrying its own
  `generated_voice_id`.

The `optimizeDeps` fix was verified by baking a 240-frame previz composition to MP4 in a
consuming project — the exact path that failed before.

The follow-up review also hardened the direct adapter: seed `0` is now sent and recorded in
take provenance, Voice Design uses ElevenLabs' smaller documented seed ceiling, missing
voice ids are blocked before submit, only the supported API endpoint shapes are accepted,
non-audio/empty TTS responses are rejected, voice promotion validates the provider's
description-length requirement, and Studio identifies the active provider as ElevenLabs
rather than fal.

---

## Known issues found but not fixed here

**Muted and unpinned items still block preview swaps.** An edit timeline that references
generative comps with no pinned take throws during `swapPreview` —
`voPayroll needs a pinned audio take before it can be baked` — **even when the item is
`"muted": true`**. Wiring VO ahead of generation is normal, so muted or unpinned items
should soft-skip and surface as a per-item badge instead of failing the swap.

**The git dependency ships ~3GB of LFS media.** `.git` is about 3.1GB, essentially all
example assets. `npm install` of the git dependency smudges all of it; the clone reached
5.7GB and exhausted the disk, and npm reported it misleadingly as
`fatal: destination path ... already exists and is not an empty directory` rather than
ENOSPC. Until this is addressed, consumers should update with:

```sh
GIT_LFS_SKIP_SMUDGE=1 npm update framediff-monorepo
```

Consumers only need `packages/**`. Candidate fixes: an `.lfsconfig` with
`lfs.fetchexclude = examples/**`, moving example media out of the repo, or publishing the
packages to npm.
