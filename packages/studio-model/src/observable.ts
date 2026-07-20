export type Unsubscribe = () => void;

export class ObservableValue<T> {
  private listeners = new Set<(value: T) => void>();

  public constructor(private value: T) {}

  public get(): T {
    return this.value;
  }

  public set(value: T): void {
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const listener of this.listeners) listener(value);
  }

  public update(updater: (value: T) => T): void {
    this.set(updater(this.value));
  }

  public subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.value);
    return () => this.listeners.delete(listener);
  }
}
