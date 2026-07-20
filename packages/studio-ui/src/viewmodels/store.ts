import { readable, type Readable } from "svelte/store";
import type { ObservableValue, StudioSession, StudioSessionState } from "@framediff/studio-model";

export function sessionStore(session: StudioSession): Readable<StudioSessionState> {
  return readable(session.state.get(), (set) => session.state.subscribe(set));
}

export function observableStore<T>(value: ObservableValue<T>): Readable<T> {
  return readable(value.get(), (set) => value.subscribe(set));
}
