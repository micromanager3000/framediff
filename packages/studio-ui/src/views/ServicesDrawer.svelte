<script lang="ts">
  import { onMount } from "svelte";
  import type { ProviderCredentialSnapshot } from "@framediff/studio-model";
  import type { ServicesViewModel } from "../viewmodels/Services.ViewModel";

  export let viewModel: ServicesViewModel;
  export let onclose: () => void;
  export let onchange: () => void;

  const store = viewModel.store;
  let drafts: Record<string, string> = {};

  onMount(() => {
    void viewModel.refresh();
  });

  function updateDraft(provider: string, value: string): void {
    drafts = { ...drafts, [provider]: value };
  }

  async function save(provider: ProviderCredentialSnapshot): Promise<void> {
    const key = (drafts[provider.provider] ?? "").trim();
    if (!key) return;
    if (await viewModel.configure(provider.provider, key)) {
      updateDraft(provider.provider, "");
      onchange();
    }
  }

  async function clear(provider: ProviderCredentialSnapshot): Promise<void> {
    if (await viewModel.clear(provider.provider)) {
      updateDraft(provider.provider, "");
      onchange();
    }
  }
</script>

<aside class="services-drawer" aria-label="Services">
  <header class="services-heading">
    <div><strong>SERVICES</strong><span>LOCAL CREDENTIALS</span></div>
    <button onclick={onclose} aria-label="Close services">×</button>
  </header>

  <section class="services-security">
    <span class="services-lock" aria-hidden="true">⌾</span>
    <div>
      <strong>Local prototype storage</strong>
      <p>Keys are saved as plaintext in <code>{$store.credentials?.file ?? ".framediff/secrets.json"}</code>. The directory is gitignored and secret values are never sent back to this UI.</p>
    </div>
  </section>

  <div class="services-list">
    {#if $store.loading && !$store.credentials}
      <div class="panel-empty">Reading local credentials…</div>
    {:else}
      {#each $store.credentials?.providers ?? [] as provider (provider.provider)}
        {@const busy = $store.busyProvider === provider.provider}
        {@const draft = drafts[provider.provider] ?? ""}
        <section class="service-card">
          <div class="service-title">
            <span class="service-mark">{provider.name.slice(0, 1)}</span>
            <div><strong>{provider.name}</strong><small>{provider.envVar}</small></div>
            <i class:active={provider.integration === "active"}>
              {provider.integration === "active" ? "CONNECTED ADAPTER" : "CREDENTIALS ONLY"}
            </i>
          </div>
          <p>{provider.description}</p>
          <div class:set={provider.set} class="service-status">
            <span class="status-dot"></span>
            {#if provider.set}
              <strong>Configured</strong>
              <code>•••• {provider.last4}</code>
              <small>{provider.source === "env" ? "environment" : "local file"}</small>
            {:else}
              <strong>Not configured</strong>
              <small>add {provider.envVar} below</small>
            {/if}
          </div>
          <label class="service-key">
            <span>{provider.set ? "REPLACE API KEY" : "API KEY"}</span>
            <input
              type="password"
              autocomplete="off"
              spellcheck="false"
              value={draft}
              placeholder={provider.set ? `Configured · ending ${provider.last4 ?? "••••"}` : provider.envVar}
              oninput={(event) => updateDraft(provider.provider, event.currentTarget.value)}
              onkeydown={(event) => {
                if (event.key === "Enter" && draft.trim().length >= 8 && !$store.busyProvider) void save(provider);
              }}
            />
          </label>
          <div class="service-actions">
            {#if provider.source === "file"}
              <button class="service-remove" disabled={busy || !!$store.busyProvider} onclick={() => void clear(provider)}>Remove local key</button>
            {:else if provider.source === "env"}
              <small>Managed by the environment. Saving here will override it locally.</small>
            {:else}
              <small>Minimum 8 characters.</small>
            {/if}
            <button class="service-save" disabled={busy || !!$store.busyProvider || draft.trim().length < 8} onclick={() => void save(provider)}>
              {busy ? "Saving…" : provider.set ? "Replace key" : "Save key"}
            </button>
          </div>
        </section>
      {:else}
        <div class="panel-empty">No credential providers are available.</div>
      {/each}
    {/if}
  </div>

  <footer class="services-footer">
    {#if $store.error}<div class="message error">{$store.error}</div>{/if}
    {#if $store.message}<div class="message notice">{$store.message}</div>{/if}
    <p>Restart-free: saved credentials are available to generation immediately.</p>
  </footer>
</aside>
