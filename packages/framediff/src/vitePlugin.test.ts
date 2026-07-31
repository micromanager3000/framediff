import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { framediffDev, type FrameDiffDevOptions } from "../vite-plugin";

type Response = { status: number; body: string; headers: Record<string, string> };

function devBridge(root: string, options?: FrameDiffDevOptions) {
  let middleware: (req: unknown, res: unknown, next: (error?: unknown) => void) => void = () => {
    throw new Error("middleware not configured");
  };
  framediffDev(options).configureServer({
    config: { root },
    middlewares: {
      use(handler) {
        middleware = handler as typeof middleware;
      },
    },
    watcher: { unwatch: vi.fn() },
  });

  return (url: string, method = "GET", body?: Uint8Array, requestHeaders: Record<string, string> = {}) => new Promise<Response>((resolve, reject) => {
    const req = Readable.from(body ? [body] : []) as Readable & {
      url: string;
      method: string;
      headers: Record<string, string>;
    };
    req.url = url;
    req.method = method;
    req.headers = requestHeaders;
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      setHeader(name: string, value: string | number) {
        headers[name.toLowerCase()] = String(value);
      },
      end(value?: string) {
        resolve({ status: this.statusCode, body: value ?? "", headers });
      },
    };
    middleware(req, res, (error) => error ? reject(error) : reject(new Error("request was not handled")));
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const gitLfsAvailable = (() => {
  try {
    execFileSync("git", ["lfs", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("framediffDev local cache folder", () => {
  it("submits and finalizes a direct BytePlus Seedance task", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-byteplus-"));
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") {
        return new globalThis.Response(JSON.stringify({ id: "cgt-direct-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/contents/generations/tasks/cgt-direct-1")) {
        return new globalThis.Response(JSON.stringify({
          id: "cgt-direct-1",
          status: "succeeded",
          seed: 12,
          content: { video_url: "https://media.example/direct.mp4" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://media.example/direct.mp4") {
        return new globalThis.Response(new TextEncoder().encode("direct video"), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const request = devBridge(root);
    await request(
      "/__framediff/secrets",
      "PUT",
      new TextEncoder().encode(JSON.stringify({ provider: "byteplus", key: "ark-test-key-1234" })),
      { "content-type": "application/json" },
    );

    const submitted = await request(
      "/__framediff/gen/submit",
      "POST",
      new TextEncoder().encode(JSON.stringify({
        provider: "byteplus",
        gen: "dialogue",
        endpoint: "dreamina-seedance-2-0-fast-260128",
        recipeHash: "sha256:recipe",
        input: {
          prompt: "Image 1 performs to Audio 1.",
          resolution: "720p",
          duration: 5,
          ratio: "9:16",
          generate_audio: true,
          watermark: false,
        },
        refs: [
          { kind: "image", src: "https://media.example/portrait.jpg", authoredSrc: "asset://portrait" },
          { kind: "audio", src: "https://media.example/dialogue.mp3", authoredSrc: "asset://dialogue" },
        ],
        recipe: {
          provider: "byteplus",
          model: "seedance-2.0-direct",
          prompt: "Image 1 performs to Audio 1.",
        },
      })),
      { "content-type": "application/json" },
    );
    expect(submitted.status).toBe(200);
    expect(JSON.parse(submitted.body).job).toMatchObject({
      provider: "byteplus",
      providerJobId: "cgt-direct-1",
      status: "queued",
    });

    const post = calls.find((call) => call.init?.method === "POST");
    expect(post?.init?.headers).toMatchObject({ authorization: "Bearer ark-test-key-1234" });
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({
      model: "dreamina-seedance-2-0-fast-260128",
      content: [
        { type: "text", text: "Image 1 performs to Audio 1." },
        { type: "image_url", image_url: { url: "https://media.example/portrait.jpg" }, role: "reference_image" },
        { type: "audio_url", audio_url: { url: "https://media.example/dialogue.mp3" }, role: "reference_audio" },
      ],
    });

    const jobs = JSON.parse((await request("/__framediff/gen/jobs?gen=dialogue")).body);
    expect(jobs.jobs[0]).toMatchObject({
      provider: "byteplus",
      autoPinIfEmpty: true,
      status: "done",
      take: 1,
      seed: 12,
    });
    expect(jobs.takes[0]).toMatchObject({ mime: "video/mp4", generator: { endpoint: "dreamina-seedance-2-0-fast-260128" } });
  });

  it("migrates ignored generation jobs into a repo-tracked numbered ledger", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-generations-"));
    const legacyDir = path.join(root, ".framediff");
    fs.mkdirSync(legacyDir);
    fs.writeFileSync(path.join(legacyDir, "gen-jobs.json"), JSON.stringify({
      version: 1,
      jobs: [{
        id: "provider-request-1",
        gen: "dialogue",
        endpoint: "provider/model",
        recipeHash: "sha256:recipe",
        statusUrl: "https://queue.example/requests/provider-request-1/status",
        responseUrl: "https://queue.example/requests/provider-request-1",
        status: "failed",
        error: "Provider rejected the references.",
        at: "2026-07-23T00:00:00.000Z",
        doneAt: "2026-07-23T00:01:00.000Z",
        recipe: { provider: "fal", model: "seedance-2.0", prompt: "Dialogue" },
        inputs: [{ kind: "image", src: "asset://portrait", contentHash: "sha256:portrait" }],
      }],
    }));
    const request = devBridge(root);

    const response = JSON.parse((await request("/__framediff/gen/jobs?gen=dialogue")).body);
    const ledger = JSON.parse(fs.readFileSync(path.join(root, "framediff.generations.json"), "utf8"));

    expect(response.jobs[0]).toMatchObject({
      id: "provider-request-1",
      providerJobId: "provider-request-1",
      take: 1,
      status: "failed",
      error: "Provider rejected the references.",
    });
    expect(ledger.jobs).toEqual(response.jobs);
  });

  it("does not create a generation ledger when an empty project is read", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-generations-empty-"));
    const request = devBridge(root);

    const response = JSON.parse((await request("/__framediff/gen/jobs?gen=dialogue")).body);

    expect(response).toMatchObject({ jobs: [], takes: [] });
    expect(fs.existsSync(path.join(root, "framediff.generations.json"))).toBe(false);
  });

  it("prebundles the module worker dependency before the first bake", () => {
    const config = framediffDev().config();

    expect(config.optimizeDeps.include).toContain("mp4-muxer");
    // The excluded source's one pure-CJS dep still needs esbuild interop.
    expect(config.optimizeDeps.include).toContain("@babel/parser");
    // Never prebundle the engine: exportVideo's encode worker resolves relative to
    // import.meta.url, which 404s from a .vite/deps chunk in git-dependency consumers.
    expect(config.optimizeDeps.exclude).toContain("framediff");
    expect(config.optimizeDeps.exclude).toContain("framediff/studio-runtime");
    expect(config.optimizeDeps.exclude).toContain("@framediff/studio-model");
    expect(config.optimizeDeps.exclude).toContain("@framediff/studio-ui");
    expect(config.server.fs.allow).toHaveLength(1);
    expect(config.build.chunkSizeWarningLimit).toBe(800);
    expect(config.build.rollupOptions.output.onlyExplicitManualChunks).toBe(false);
    const chunk = config.build.rollupOptions.output.manualChunks;
    expect(chunk("/repo/packages/studio-ui/src/StudioShell.svelte")).toBe("framediff-studio-ui");
    expect(chunk("/repo/packages/studio-model/src/StudioSession.ts")).toBe("framediff-studio-model");
    expect(chunk("/repo/packages/framediff/src/studio-runtime/runtime.ts")).toBe("framediff-studio-runtime");
    expect(chunk("/repo/packages/framediff/src/gsap/traces.ts")).toBe("framediff-studio-runtime");
    expect(chunk("/repo/node_modules/@framediff/studio-ui/src/StudioShell.svelte")).toBe("framediff-studio-ui");
    expect(chunk("/repo/node_modules/framediff/src/studio-runtime/runtime.ts")).toBe("framediff-studio-runtime");
    expect(chunk("/repo/node_modules/gsap/gsap-core.js")).toBe("vendor-gsap");
    // Three is already behind dynamic imports. Let Rollup omit it entirely from
    // projects that do not use it instead of forcing an empty vendor chunk.
    expect(chunk("/repo/node_modules/three/build/three.module.js")).toBeUndefined();
    expect(chunk("/repo/packages/framediff/src/render/videoFrames.ts")).toBeUndefined();
  });

  it("lands a synchronous ElevenLabs read as a finished take", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-eleven-"));
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === "https://api.elevenlabs.io/v1/text-to-speech/vox-jimmy-01") {
        // ElevenLabs answers with audio bytes directly — no queue, no polling.
        return new globalThis.Response(new TextEncoder().encode("ID3 jimmy narration"), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const request = devBridge(root);
    await request(
      "/__framediff/secrets",
      "PUT",
      new TextEncoder().encode(JSON.stringify({ provider: "elevenlabs", key: "xi-test-key-1234" })),
      { "content-type": "application/json" },
    );

    const submitted = await request(
      "/__framediff/gen/submit",
      "POST",
      new TextEncoder().encode(JSON.stringify({
        provider: "elevenlabs",
        gen: "voiceJimmy",
        endpoint: "v1/text-to-speech/vox-jimmy-01",
        recipeHash: "sha256:recipe",
        input: { text: "Red Hook, Brooklyn. Nineteen thirty-two.", model_id: "eleven_v3", seed: 0 },
        recipe: { id: "voiceJimmy", provider: "elevenlabs", model: "elevenlabs-direct", prompt: "Red Hook, Brooklyn. Nineteen thirty-two.", seed: 0 },
      })),
      { "content-type": "application/json" },
    );

    expect(submitted.status).toBe(200);
    // Done at submit time, with the take already pinned to an asset.
    expect(JSON.parse(submitted.body).job).toMatchObject({
      provider: "elevenlabs",
      status: "done",
      take: 1,
      seed: 0,
      outputKind: "audio",
    });
    expect(JSON.parse(submitted.body).job.assetId).toBeTruthy();

    const post = calls.find((call) => call.init?.method === "POST");
    expect(post?.init?.headers).toMatchObject({ "xi-api-key": "xi-test-key-1234" });

    const jobs = JSON.parse((await request("/__framediff/gen/jobs?gen=voiceJimmy")).body);
    expect(jobs.takes[0]).toMatchObject({
      mime: "audio/mpeg",
      generator: { gen: "voiceJimmy", take: 1, seed: 0, outputKind: "audio" },
    });
  });

  it("turns Voice Design candidates into one take each", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-vdesign-"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://api.elevenlabs.io/v1/text-to-voice/design") {
        return new globalThis.Response(JSON.stringify({
          text: "A neighborhood's like a pie.",
          previews: [
            { audio_base_64: Buffer.from("candidate one").toString("base64"), generated_voice_id: "gen-a", media_type: "audio/mp3", duration_secs: 6 },
            { audio_base_64: Buffer.from("candidate two").toString("base64"), generated_voice_id: "gen-b", media_type: "audio/mp3", duration_secs: 6 },
            { audio_base_64: Buffer.from("candidate three").toString("base64"), generated_voice_id: "gen-c", media_type: "audio/mp3", duration_secs: 6 },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const request = devBridge(root);
    await request(
      "/__framediff/secrets",
      "PUT",
      new TextEncoder().encode(JSON.stringify({ provider: "elevenlabs", key: "xi-test-key-1234" })),
      { "content-type": "application/json" },
    );

    await request(
      "/__framediff/gen/submit",
      "POST",
      new TextEncoder().encode(JSON.stringify({
        provider: "elevenlabs",
        gen: "designJimmy",
        endpoint: "v1/text-to-voice/design",
        recipeHash: "sha256:design",
        input: { voice_description: "Sixty-three, Brooklyn, gravel under warm butter." },
        recipe: { id: "designJimmy", provider: "elevenlabs", model: "elevenlabs-voice-design", prompt: "Sixty-three, Brooklyn, gravel under warm butter." },
      })),
      { "content-type": "application/json" },
    );

    const jobs = JSON.parse((await request("/__framediff/gen/jobs?gen=designJimmy")).body);
    // Three candidates, three takes — the takes rail becomes the audition.
    expect(jobs.jobs).toHaveLength(3);
    expect(jobs.jobs.map((j: { take: number }) => j.take)).toEqual([1, 2, 3]);
    expect(jobs.jobs.every((j: { status: string }) => j.status === "done")).toBe(true);
    // Each take remembers the candidate id needed to promote it to a real voice.
    const generated = jobs.takes.map((t: { generator?: { generatedVoiceId?: string } }) => t.generator?.generatedVoiceId);
    expect(generated).toEqual(expect.arrayContaining(["gen-a", "gen-b", "gen-c"]));
  });

  it("routes ElevenLabs recipes to the provider's own API instead of rejecting them", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    const request = devBridge(root);

    // No key yet: the provider is recognised, so the error is about credentials rather
    // than "unsupported generation provider" (the pre-ElevenLabs behaviour).
    const submitted = await request(
      "/__framediff/gen/submit",
      "POST",
      new TextEncoder().encode(JSON.stringify({
        provider: "elevenlabs",
        gen: "voiceJimmy",
        endpoint: "v1/text-to-speech/abc123",
        recipeHash: "sha256:recipe",
        input: { text: "Red Hook, nineteen thirty-two." },
        recipe: { id: "voiceJimmy", prompt: "Red Hook, nineteen thirty-two.", provider: "elevenlabs" },
      })),
      { "content-type": "application/json" },
    );
    expect(submitted.status).toBe(400);
    expect(JSON.parse(submitted.body).error).toContain("elevenlabs key");
    expect(JSON.parse(submitted.body).error).not.toContain("unsupported");
  });

  it("restricts ElevenLabs submits to the two supported endpoint shapes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    const request = devBridge(root);

    const submitted = await request(
      "/__framediff/gen/submit",
      "POST",
      new TextEncoder().encode(JSON.stringify({
        provider: "elevenlabs",
        gen: "unsafe",
        endpoint: "v1/user",
        recipeHash: "sha256:recipe",
        input: { text: "not really speech" },
        recipe: { model: "elevenlabs-direct", prompt: "not really speech" },
      })),
      { "content-type": "application/json" },
    );

    expect(submitted.status).toBe(400);
    expect(JSON.parse(submitted.body).error).toBe("unsupported ElevenLabs endpoint");
  });

  it("passes each voice's hosted sample through so the Studio can audition without generating", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-voicelist-"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input) === "https://api.elevenlabs.io/v1/voices") {
        return new globalThis.Response(JSON.stringify({
          voices: [{
            voice_id: "vox-jimmy",
            name: "Jimmy Monster",
            category: "generated",
            description: "Gravel under warm butter.",
            preview_url: "https://media.elevenlabs.io/jimmy.mp3",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    }));
    const request = devBridge(root);
    await request(
      "/__framediff/secrets",
      "PUT",
      new TextEncoder().encode(JSON.stringify({ provider: "elevenlabs", key: "xi-test-key-1234" })),
      { "content-type": "application/json" },
    );

    const listed = await request("/__framediff/gen/voices");
    expect(listed.status).toBe(200);
    expect(JSON.parse(listed.body).voices[0]).toMatchObject({
      voice_id: "vox-jimmy",
      name: "Jimmy Monster",
      category: "generated",
      preview_url: "https://media.elevenlabs.io/jimmy.mp3",
    });
  });

  it("exposes voice discovery and validates promotion inputs for ElevenLabs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    const request = devBridge(root);

    // Voice ids are account-specific, so the bridge lists them rather than hardcoding.
    const voices = await request("/__framediff/gen/voices");
    expect(voices.status).toBe(400);
    expect(JSON.parse(voices.body).error).toContain("elevenlabs key");

    await request(
      "/__framediff/secrets",
      "PUT",
      new TextEncoder().encode(JSON.stringify({ provider: "elevenlabs", key: "xi-test-key-1234" })),
      { "content-type": "application/json" },
    );

    // Promotion validates the documented API minimum before spending a provider call.
    const created = await request(
      "/__framediff/gen/voice/create",
      "POST",
      new TextEncoder().encode(JSON.stringify({
        generatedVoiceId: "generated-voice-1",
        name: "Jimmy Monster",
        description: "too short",
      })),
      { "content-type": "application/json" },
    );
    expect(created.status).toBe(400);
    expect(JSON.parse(created.body).error).toContain("between 20 and 1000");
  });

  it("writes to the visible default without reading the former hidden cache", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    const legacy = path.join(root, ".framediff-cache");
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, "old-artifact"), "old");
    const request = devBridge(root);

    const listing = await request("/__framediff/cache");
    expect(JSON.parse(listing.body)).toMatchObject({
      directory: path.join(root, "framediff-cache"),
      entries: [],
    });
    expect((await request("/__framediff-cache/old-artifact", "HEAD")).status).toBe(404);

    await request("/__framediff-cache/new-artifact", "PUT", new TextEncoder().encode("new"));
    expect(fs.readFileSync(path.join(root, "framediff-cache", "new-artifact"), "utf8")).toBe("new");
  });

  it("accepts an explicit folder relative to the Vite root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    const request = devBridge(root, { cacheDir: "local-files/cache" });

    const listing = await request("/__framediff/cache");
    expect(JSON.parse(listing.body).directory).toBe(path.join(root, "local-files/cache"));
  });

  it("reads a local asset folder from framediff.config.json", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    fs.writeFileSync(path.join(root, "framediff.config.json"), JSON.stringify({
      assets: { mode: "local", path: "selected-media" },
    }));
    const request = devBridge(root);
    const bytes = new TextEncoder().encode("configured asset bytes");

    const listing = JSON.parse((await request("/__framediff/cache")).body);
    expect(listing).toMatchObject({
      directory: path.join(root, "selected-media"),
      storage: "local",
    });
    const upload = await request("/__framediff/assets/upload?name=Configured.mov", "POST", bytes);
    expect(upload.status).toBe(200);
    expect(fs.readdirSync(listing.directory)).toEqual([
      expect.stringMatching(/^Configured--sha256-[a-f0-9]{64}\.mov$/),
    ]);
  });

  it("keeps the explicit plugin folder as a local override of project config", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    fs.writeFileSync(path.join(root, "framediff.config.json"), JSON.stringify({
      assets: { mode: "git-lfs" },
    }));
    const request = devBridge(root, { cacheDir: "override-assets" });

    expect(JSON.parse((await request("/__framediff/cache")).body)).toMatchObject({
      directory: path.join(root, "override-assets"),
      storage: "local",
    });
    expect(fs.existsSync(path.join(root, ".gitattributes"))).toBe(false);
  });

  it("rejects a local project config without an asset path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    fs.writeFileSync(path.join(root, "framediff.config.json"), JSON.stringify({
      assets: { mode: "local" },
    }));

    expect(() => devBridge(root)).toThrow("local assets require a non-empty assets.path");
  });

  it.skipIf(!gitLfsAvailable)("puts Git LFS assets in the project and stages them as LFS pointers", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-lfs-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    fs.writeFileSync(path.join(root, "framediff.config.json"), JSON.stringify({
      assets: { mode: "git-lfs" },
    }, null, 2) + "\n");
    const request = devBridge(root);
    const bytes = new TextEncoder().encode("lfs video bytes");

    expect(fs.existsSync(path.join(root, "assets"))).toBe(true);
    expect(fs.readFileSync(path.join(root, ".gitattributes"), "utf8")).toBe(
      "assets/** filter=lfs diff=lfs merge=lfs -text\n",
    );
    const listing = JSON.parse((await request("/__framediff/cache")).body);
    expect(listing).toMatchObject({ directory: path.join(root, "assets"), storage: "git-lfs" });

    const upload = await request("/__framediff/assets/upload?name=LFS%20Clip.mp4", "POST", bytes);
    expect(upload.status).toBe(200);
    const filename = fs.readdirSync(path.join(root, "assets"))[0];
    expect(filename).toMatch(/^LFS-Clip--sha256-[a-f0-9]{64}\.mp4$/);
    expect(execFileSync("git", ["check-attr", "filter", "--", `assets/${filename}`], {
      cwd: root,
      encoding: "utf8",
    }).trim()).toMatch(/filter: lfs$/);

    execFileSync("git", ["add", ".gitattributes", "framediff.config.json", "framediff.assets.json", `assets/${filename}`], { cwd: root });
    const staged = execFileSync("git", ["show", `:assets/${filename}`], { cwd: root, encoding: "utf8" });
    expect(staged).toContain("version https://git-lfs.github.com/spec/v1");
    expect(staged).toContain(`size ${bytes.length}`);

    devBridge(root);
    expect(fs.readFileSync(path.join(root, ".gitattributes"), "utf8").match(/assets\/\*\*/g)).toHaveLength(1);
  });

  it("accepts FRAMEDIFF_CACHE_DIR when no plugin option is supplied", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    vi.stubEnv("FRAMEDIFF_CACHE_DIR", "shared-files");
    const request = devBridge(root);

    const listing = await request("/__framediff/cache");
    expect(JSON.parse(listing.body).directory).toBe(path.join(root, "shared-files"));
  });

  it("resolves manifest hashes from human-readable cache filenames", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    const hash = "a".repeat(64);
    const cache = path.join(root, "framediff-cache");
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, `proxy-open--sha256-${hash}.mp4`), "video");
    const request = devBridge(root);

    const response = await request(`/__framediff-cache/${encodeURIComponent(`sha256:${hash}`)}`, "HEAD");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("video/mp4");
  });

  it("reads ignored cache and public media from an equivalent shared project", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-worktree-"));
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-primary-"));
    const hash = "b".repeat(64);
    fs.mkdirSync(path.join(shared, "framediff-cache"));
    fs.writeFileSync(path.join(shared, "framediff-cache", `proxy--sha256-${hash}.mp4`), "video");
    fs.mkdirSync(path.join(shared, "public"));
    fs.writeFileSync(path.join(shared, "public", "shine.wav"), "audio");
    const request = devBridge(root, { sharedProjectDir: shared });

    expect((await request(`/__framediff-cache/${encodeURIComponent(`sha256:${hash}`)}`, "HEAD")).status).toBe(200);
    const audio = await request("/shine.wav", "HEAD");
    expect(audio.status).toBe(200);
    expect(audio.headers["content-type"]).toBe("audio/wav");
  });

  it("stores imported assets under readable hash-suffixed filenames", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    const request = devBridge(root);
    const bytes = new TextEncoder().encode("example video bytes");
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const filename = `My-Example-Clip--${hash.replace(":", "-")}.mp4`;

    const upload = await request("/__framediff/assets/upload?name=My%20Example%20Clip.mp4", "POST", bytes);
    expect(upload.status).toBe(200);
    expect(fs.readFileSync(path.join(root, "framediff-cache", filename))).toEqual(Buffer.from(bytes));

    const head = await request(`/__framediff-cache/${encodeURIComponent(hash)}`, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers["content-type"]).toBe("video/mp4");

    const listing = JSON.parse((await request("/__framediff/cache")).body);
    expect(listing.entries).toEqual([
      expect.objectContaining({ name: hash, contentHash: hash, filename, size: bytes.length }),
    ]);

    await request("/__framediff/assets/upload?name=Alternate%20Name.mp4", "POST", bytes);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "framediff.assets.json"), "utf8"));
    const entry = Object.values(manifest.assets)[0] as { aliases?: string[] };
    expect(entry.aliases).toEqual(["Alternate Name.mp4"]);
    expect(fs.readdirSync(path.join(root, "framediff-cache"))).toEqual([filename]);
  });

  it("rebuilds hash lookup from readable filenames on startup", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    const cacheDir = path.join(root, "framediff-cache");
    const hash = `sha256:${"b".repeat(64)}`;
    const filename = `Existing-Clip--${hash.replace(":", "-")}.mp4`;
    fs.mkdirSync(cacheDir);
    fs.writeFileSync(path.join(cacheDir, filename), "existing");

    const request = devBridge(root);
    expect((await request(`/__framediff-cache/${encodeURIComponent(hash)}`, "HEAD")).status).toBe(200);
    expect(JSON.parse((await request("/__framediff/cache")).body).entries).toEqual([
      expect.objectContaining({ name: hash, contentHash: hash, filename }),
    ]);
  });

  it("keeps artifact sidecars beside a named physical cache file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    const request = devBridge(root);
    const hash = `sha256:${"a".repeat(64)}`;
    const filename = `LowerThird.bake--${hash.replace(":", "-")}.mp4`;
    const bytes = new TextEncoder().encode("bake");
    const meta = { compId: "LowerThird", label: "LowerThird bake", inputs: {}, createdAt: "2026-07-14T00:00:00.000Z" };

    await request(
      `/__framediff-cache/${encodeURIComponent(hash)}?name=LowerThird.bake.mp4`,
      "PUT",
      bytes,
      { "content-type": "video/mp4" },
    );
    await request(
      `/__framediff-cache/${encodeURIComponent(hash)}.meta.json`,
      "PUT",
      new TextEncoder().encode(JSON.stringify(meta)),
      { "content-type": "application/json" },
    );

    const cacheDir = path.join(root, "framediff-cache");
    expect(fs.existsSync(path.join(cacheDir, filename))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(cacheDir, `${filename}.meta.json`), "utf8"))).toEqual(meta);
    const listing = JSON.parse((await request("/__framediff/cache")).body);
    expect(listing.entries).toEqual([expect.objectContaining({ name: hash, filename, meta })]);
  });

  it("rejects invalid or missing cache entries before revealing them on disk", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    const request = devBridge(root);

    expect((await request("/__framediff/cache/reveal?hash=not-a-hash", "POST")).status).toBe(400);
    expect((await request(`/__framediff/cache/reveal?hash=${encodeURIComponent(`sha256:${"c".repeat(64)}`)}`, "POST")).status).toBe(404);
  });
});

describe("framediffDev source bridge", () => {
  it("applies an atomic revision-checked edit and returns an exact receipt", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    fs.writeFileSync(path.join(root, "A.html"), "before-a");
    fs.writeFileSync(path.join(root, "B.ts"), "before-b");
    const request = devBridge(root);
    const a = JSON.parse((await request("/__framediff/src?file=A.html")).body) as { hash: string };
    const b = JSON.parse((await request("/__framediff/src?file=B.ts")).body) as { hash: string };

    const edit = await request(
      "/__framediff/edit",
      "POST",
      new TextEncoder().encode(JSON.stringify({
        label: "Edit two files",
        groupId: "gesture:1",
        files: [
          { file: "A.html", expectedHash: a.hash, text: "after-a" },
          { file: "B.ts", expectedHash: b.hash, text: "after-b" },
        ],
      })),
      { "content-type": "application/json" },
    );

    expect(edit.status).toBe(200);
    const result = JSON.parse(edit.body);
    expect(result).toMatchObject({
      ok: true,
      receipt: {
        label: "Edit two files",
        groupId: "gesture:1",
        before: [
          { file: "A.html", text: "before-a", hash: a.hash },
          { file: "B.ts", text: "before-b", hash: b.hash },
        ],
        after: [
          { file: "A.html", text: "after-a" },
          { file: "B.ts", text: "after-b" },
        ],
      },
    });
    expect(fs.readFileSync(path.join(root, "A.html"), "utf8")).toBe("after-a");
    expect(fs.readFileSync(path.join(root, "B.ts"), "utf8")).toBe("after-b");
    expect(fs.readdirSync(root).filter((name) => name.includes(".framediff-"))).toEqual([]);
  });

  it("rejects the whole transaction when one source revision changed", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    fs.writeFileSync(path.join(root, "A.html"), "before-a");
    fs.writeFileSync(path.join(root, "B.ts"), "before-b");
    const request = devBridge(root);
    const a = JSON.parse((await request("/__framediff/src?file=A.html")).body) as { hash: string };
    const b = JSON.parse((await request("/__framediff/src?file=B.ts")).body) as { hash: string };
    fs.writeFileSync(path.join(root, "B.ts"), "external-change");

    const edit = await request(
      "/__framediff/edit",
      "POST",
      new TextEncoder().encode(JSON.stringify({
        label: "Conflicting edit",
        files: [
          { file: "A.html", expectedHash: a.hash, text: "after-a" },
          { file: "B.ts", expectedHash: b.hash, text: "after-b" },
        ],
      })),
    );

    expect(edit.status).toBe(409);
    expect(JSON.parse(edit.body)).toMatchObject({
      ok: false,
      conflicts: [{ file: "B.ts", expectedHash: b.hash }],
    });
    expect(fs.readFileSync(path.join(root, "A.html"), "utf8")).toBe("before-a");
    expect(fs.readFileSync(path.join(root, "B.ts"), "utf8")).toBe("external-change");
  });

  it("supports exact create/delete replay semantics", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    const request = devBridge(root);
    const created = await request(
      "/__framediff/edit",
      "POST",
      new TextEncoder().encode(JSON.stringify({
        label: "Create source",
        files: [{ file: "nested/New.html", expectedHash: null, text: "new" }],
      })),
    );
    expect(created.status).toBe(200);
    const after = JSON.parse(created.body).receipt.after[0];
    expect(fs.readFileSync(path.join(root, "nested/New.html"), "utf8")).toBe("new");

    const removed = await request(
      "/__framediff/edit",
      "POST",
      new TextEncoder().encode(JSON.stringify({
        label: "Undo create",
        files: [{ file: "nested/New.html", expectedHash: after.hash, text: null }],
      })),
    );
    expect(removed.status).toBe(200);
    expect(fs.existsSync(path.join(root, "nested/New.html"))).toBe(false);
  });

  it("deletes a source file, 404s a missing one, and refuses escapes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framediff-vite-"));
    fs.writeFileSync(path.join(root, "Comp.tsx"), "export const x = 1;\n");
    const request = devBridge(root);

    const gone = await request("/__framediff/src?file=Comp.tsx", "DELETE");
    expect(gone.status).toBe(200);
    expect(fs.existsSync(path.join(root, "Comp.tsx"))).toBe(false);

    const missing = await request("/__framediff/src?file=Comp.tsx", "DELETE");
    expect(missing.status).toBe(404);

    const escape = await request(`/__framediff/src?file=${encodeURIComponent("../outside.tsx")}`, "DELETE");
    expect(escape.status).toBe(403);
  });
});
