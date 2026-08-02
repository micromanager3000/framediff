import { AssetManager } from "./managers/AssetManager";
import { GitManager } from "./managers/GitManager";
import { RenderManager } from "./managers/RenderManager";
import { SourceManager } from "./managers/SourceManager";
import { InspectorManager } from "./managers/InspectorManager";
import { GenerativeManager } from "./managers/GenerativeManager";
import { CredentialsManager } from "./managers/CredentialsManager";
import { ProjectOperationsManager } from "./managers/ProjectOperationsManager";
import { HistoryManager } from "./managers/HistoryManager";
import { ProcessingManager } from "./processing";
import { StudioSession } from "./StudioSession";
import type { AnimationClock, StudioRuntimePort } from "./types";

export class StudioApplication {
  public readonly session: StudioSession;
  public readonly source: SourceManager;
  public readonly assets: AssetManager;
  public readonly git: GitManager;
  public readonly render: RenderManager;
  public readonly inspector: InspectorManager;
  public readonly generative: GenerativeManager;
  public readonly processing: ProcessingManager;
  public readonly credentials: CredentialsManager;
  public readonly operations: ProjectOperationsManager;
  public readonly history: HistoryManager;

  public constructor(
    public readonly runtime: StudioRuntimePort,
    clock: AnimationClock,
    requestedKey?: string,
  ) {
    this.session = new StudioSession(runtime, clock, requestedKey);
    this.source = new SourceManager(this.session, runtime);
    this.assets = new AssetManager(runtime);
    this.git = new GitManager(runtime);
    this.render = new RenderManager(this.session, runtime);
    this.inspector = new InspectorManager(this.session, runtime);
    this.generative = new GenerativeManager(this.session, runtime);
    this.processing = new ProcessingManager(() => this.session.state.get().currentKey, runtime);
    this.credentials = new CredentialsManager(runtime);
    this.operations = new ProjectOperationsManager(this.session, runtime);
    this.history = new HistoryManager(runtime);
  }

  public async start(): Promise<void> {
    this.source.start();
    this.inspector.start();
    this.generative.start();
    this.processing.start((listener) => this.session.state.subscribe(() => listener()));
    this.credentials.start();
    this.operations.start();
    void this.operations.refreshCache();
    this.git.start();
    this.history.start();
    void this.assets.refresh();
    await this.session.start();
  }

  public destroy(): void {
    this.source.destroy();
    this.inspector.destroy();
    this.generative.destroy();
    this.processing.destroy();
    this.credentials.destroy();
    this.operations.destroy();
    this.git.destroy();
    this.history.destroy();
    this.session.destroy();
  }
}
