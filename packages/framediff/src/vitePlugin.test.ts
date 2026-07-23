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

afterEach(() => vi.unstubAllEnvs());

const gitLfsAvailable = (() => {
  try {
    execFileSync("git", ["lfs", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("framediffDev local cache folder", () => {
  it("prebundles the module worker dependency before the first bake", () => {
    const config = framediffDev().config();

    expect(config.optimizeDeps.include).toContain("mp4-muxer");
    expect(config.server.fs.allow).toHaveLength(1);
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
