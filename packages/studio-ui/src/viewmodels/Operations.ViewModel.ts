import type { Readable } from "svelte/store";
import type { CacheEntryDescriptor, NewCompositionRequest, ProjectOperationsManager, ProjectOperationsState } from "@framediff/studio-model";
import { observableStore } from "./store";

export function cacheEntryMatchesSearch(entry: CacheEntryDescriptor, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [entry.name, entry.filename ?? "", entry.label ?? "", entry.compId ?? "", entry.contentHash ?? ""]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

export class OperationsViewModel {
  public readonly store: Readable<ProjectOperationsState>;
  public constructor(private readonly manager: ProjectOperationsManager) { this.store = observableStore(manager.state); }
  public refreshCache() { return this.manager.refreshCache(); }
  public create(request: NewCompositionRequest) { return this.manager.create(request); }
  public copy(compositionKey: string, options?: { library?: boolean }) { return this.manager.copy(compositionKey, options); }
  public nest(targetKey: string, sourceKey: string, from = 0) { return this.manager.nest(targetKey, sourceKey, from); }
  public delete(compositionKey: string) { return this.manager.delete(compositionKey); }
  public bakeCurrent() { return this.manager.bakeCurrent(); }
}
