import type { Readable } from "svelte/store";
import type { SourceManager, SourceState } from "@framediff/studio-model";
import { observableStore } from "./store";

export class CodeViewModel {
  public readonly store: Readable<SourceState>;

  public constructor(private readonly manager: SourceManager) {
    this.store = observableStore(manager.state);
  }

  public refresh(): Promise<void> {
    return this.manager.refresh();
  }
}
