import type { Readable } from "svelte/store";
import type { GitManager, GitState } from "@framediff/studio-model";
import { observableStore } from "./store";

export class GitViewModel {
  public readonly store: Readable<GitState>;

  public constructor(private readonly manager: GitManager) {
    this.store = observableStore(manager.state);
  }

  public refresh(): Promise<void> {
    return this.manager.refresh();
  }

  public commit(message: string): Promise<boolean> {
    return this.manager.commit(message);
  }
}
