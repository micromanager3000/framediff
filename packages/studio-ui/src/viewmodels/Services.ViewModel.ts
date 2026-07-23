import type { CredentialsManager, CredentialsManagerState } from "@framediff/studio-model";
import type { Readable } from "svelte/store";
import { observableStore } from "./store";

export class ServicesViewModel {
  public readonly store: Readable<CredentialsManagerState>;

  public constructor(private readonly manager: CredentialsManager) {
    this.store = observableStore(manager.state);
  }

  public refresh(): Promise<void> {
    return this.manager.refresh();
  }

  public configure(provider: string, key: string): Promise<boolean> {
    return this.manager.configure(provider, key);
  }

  public clear(provider: string): Promise<boolean> {
    return this.manager.clear(provider);
  }
}
