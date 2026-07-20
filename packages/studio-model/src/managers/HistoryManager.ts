import { ObservableValue } from "../observable";
import type {
  CompositionRuntimePort,
  ProjectEditReceipt,
  ProjectEditResult,
  SourceFileRevisionSnapshot,
} from "../types";

export interface HistoryState {
  undo: ProjectEditReceipt[];
  redo: ProjectEditReceipt[];
  applying: boolean;
  error: string | null;
}

function byFile(snapshots: SourceFileRevisionSnapshot[]): Map<string, SourceFileRevisionSnapshot> {
  return new Map(snapshots.map((snapshot) => [snapshot.file, snapshot]));
}

/** Coalesce a continuous gesture while preserving the first before and latest after revisions. */
export function mergeGroupedReceipts(previous: ProjectEditReceipt, next: ProjectEditReceipt): ProjectEditReceipt {
  const before = byFile(previous.before);
  for (const snapshot of next.before) if (!before.has(snapshot.file)) before.set(snapshot.file, snapshot);
  const after = byFile(previous.after);
  for (const snapshot of next.after) after.set(snapshot.file, snapshot);
  return {
    ...next,
    id: previous.id,
    label: next.label || previous.label,
    groupId: previous.groupId,
    before: [...before.values()],
    after: [...after.values()],
  };
}

export class HistoryManager {
  public readonly state = new ObservableValue<HistoryState>({ undo: [], redo: [], applying: false, error: null });
  private unsubscribe: (() => void) | null = null;

  public constructor(private readonly runtime: CompositionRuntimePort) {}

  public start(): void {
    if (this.unsubscribe || !this.runtime.subscribeProjectEdits) return;
    this.unsubscribe = this.runtime.subscribeProjectEdits((receipt) => this.record(receipt));
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  public record(receipt: ProjectEditReceipt): void {
    if (this.state.get().applying) return;
    this.state.update((state) => {
      const undo = [...state.undo];
      const previous = undo[undo.length - 1];
      if (receipt.groupId && previous?.groupId === receipt.groupId) {
        undo[undo.length - 1] = mergeGroupedReceipts(previous, receipt);
      } else {
        undo.push(receipt);
      }
      return { undo, redo: [], applying: false, error: null };
    });
  }

  public async undo(): Promise<boolean> {
    const receipt = this.state.get().undo.at(-1);
    if (!receipt) return false;
    return this.replay(receipt, "undo");
  }

  public async redo(): Promise<boolean> {
    const receipt = this.state.get().redo.at(-1);
    if (!receipt) return false;
    return this.replay(receipt, "redo");
  }

  public clearError(): void {
    this.state.update((state) => ({ ...state, error: null }));
  }

  private async replay(receipt: ProjectEditReceipt, direction: "undo" | "redo"): Promise<boolean> {
    if (!this.runtime.replayProjectEdit || this.state.get().applying) return false;
    this.state.update((state) => ({ ...state, applying: true, error: null }));
    let result: ProjectEditResult;
    try {
      result = await this.runtime.replayProjectEdit(receipt, direction);
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    if (!result.ok) {
      const conflict = result.conflicts?.map((entry) => entry.file).join(", ");
      this.state.update((state) => ({
        ...state,
        applying: false,
        error: result.message ?? (conflict ? `Source changed outside FrameDiff: ${conflict}` : `Could not ${direction}.`),
      }));
      return false;
    }
    this.state.update((state) => direction === "undo"
      ? {
          undo: state.undo.slice(0, -1),
          redo: [...state.redo, receipt],
          applying: false,
          error: null,
        }
      : {
          undo: [...state.undo, receipt],
          redo: state.redo.slice(0, -1),
          applying: false,
          error: null,
        });
    return true;
  }
}
