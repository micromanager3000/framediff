import { describe, expect, it, vi } from "vitest";
import type { ProjectWorkspacePort, ProviderCredentialsSnapshot } from "../types";
import { CredentialsManager } from "./CredentialsManager";

const snapshot = (set: boolean): ProviderCredentialsSnapshot => ({
  file: ".framediff/secrets.json",
  providers: [{
    provider: "fal",
    name: "fal.ai",
    envVar: "FAL_KEY",
    description: "Active generation provider.",
    integration: "active",
    set,
    ...(set ? { last4: "1234", source: "file" as const } : {}),
  }],
});

describe("CredentialsManager", () => {
  it("refreshes masked status after saving and clearing a provider", async () => {
    let configured = false;
    const workspace = {
      getProviderCredentials: vi.fn(async () => snapshot(configured)),
      configureProvider: vi.fn(async () => {
        configured = true;
        return { ok: true, message: "fal credentials saved." };
      }),
      clearProvider: vi.fn(async () => {
        configured = false;
        return { ok: true, message: "fal credentials removed." };
      }),
    } as unknown as ProjectWorkspacePort;
    const manager = new CredentialsManager(workspace);

    await manager.refresh();
    expect(manager.state.get().credentials?.providers[0].set).toBe(false);

    expect(await manager.configure("fal", "test-key-1234")).toBe(true);
    expect(manager.state.get()).toMatchObject({
      credentials: { providers: [{ set: true, last4: "1234" }] },
      busyProvider: null,
      message: "fal credentials saved.",
    });

    expect(await manager.clear("fal")).toBe(true);
    expect(manager.state.get().credentials?.providers[0].set).toBe(false);
    expect(workspace.getProviderCredentials).toHaveBeenCalledTimes(3);
  });

  it("still refreshes masked status when live verification reports a saved key as unusable", async () => {
    const workspace = {
      getProviderCredentials: vi.fn(async () => snapshot(true)),
      configureProvider: vi.fn(async () => ({ ok: false, message: "invalid key (401)" })),
    } as unknown as ProjectWorkspacePort;
    const manager = new CredentialsManager(workspace);

    expect(await manager.configure("fal", "test-key-1234")).toBe(false);
    expect(manager.state.get()).toMatchObject({
      credentials: { providers: [{ set: true }] },
      error: "invalid key (401)",
      busyProvider: null,
    });
  });
});
