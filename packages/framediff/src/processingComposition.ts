import {
  RVM_FOREGROUND_CHANNEL,
  RVM_PROCESSOR,
  validateProcessingArtifactManifest,
  validateProcessingRecipe,
  validateRvmArtifactManifest,
  type ProcessingCompositionDocument,
} from "@framediff/studio-model";
import { defineComposition, type CompositionConfig, type CompositionOutputKind } from "./composition";

export interface ProcessingCompositionOptions {
  id: string;
  file?: string;
  dataFile?: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  document: ProcessingCompositionDocument;
  /** Named channel used for preview/nesting. RVM defaults to its alpha-bearing foreground. */
  outputChannel?: string;
}

export type ProcessingComposition = CompositionConfig & {
  processing: ProcessingCompositionDocument;
  processingDataFile?: string;
  processingOutputChannel: string;
};

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;");

/** Default local-CAS URL for an immutable processing channel. Hosted adapters may rewrite it. */
export function processingChannelCacheUrl(contentHash: string): string {
  return `/__framediff-cache/${encodeURIComponent(contentHash)}`;
}

/**
 * A processing recipe is a real composition: it previews and nests its pinned named output,
 * while execution remains an injected Studio/hosted concern. No model runtime is imported here.
 */
export function processing(options: ProcessingCompositionOptions): ProcessingComposition {
  const recipeErrors = validateProcessingRecipe(options.document.recipe);
  if (recipeErrors.length) throw new Error(`Invalid processing recipe: ${recipeErrors.join("; ")}`);
  const artifact = options.document.artifact;
  if (artifact) {
    const artifactErrors = options.document.recipe.provenance.processor === RVM_PROCESSOR
      ? validateRvmArtifactManifest(artifact)
      : validateProcessingArtifactManifest(artifact);
    if (artifactErrors.length) throw new Error(`Invalid processing artifact: ${artifactErrors.join("; ")}`);
  }
  const outputChannel = options.outputChannel
    ?? (options.document.recipe.provenance.processor === RVM_PROCESSOR ? RVM_FOREGROUND_CHANNEL : "preview");
  const pinned = artifact
    && options.document.recipeFingerprint === artifact.recipeFingerprint
    && options.document.pinnedRecipeFingerprint === artifact.recipeFingerprint
    ? artifact.channels[outputChannel]
    : undefined;
  const outputKind: CompositionOutputKind = (pinned?.timing?.frameCount ?? options.durationInFrames) > 1 ? "video" : "image";
  const url = pinned ? processingChannelCacheUrl(pinned.contentHash) : "";
  const media = outputKind === "video"
    ? `<video data-processing-output data-fd-type="video" data-fd-src="${escapeHtml(url)}" muted playsinline></video>`
    : `<img data-processing-output data-fd-type="image" data-fd-src="${escapeHtml(url)}" alt="">`;
  const status = pinned
    ? `${escapeHtml(outputChannel)} · ${escapeHtml(pinned.contentHash)}`
    : artifact
      ? "artifact available but not pinned to this recipe"
      : "no artifact yet — run processing from Studio";
  const source = `<!doctype html><html><head><style>
    [data-fd-composition] { position:relative;overflow:hidden;background:transparent;color:#d9e1ea;font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
    video,img { position:absolute;inset:0;width:100%;height:100%;object-fit:contain; }
    .processing-slate { position:absolute;inset:0;display:grid;place-items:center;text-align:center;background:linear-gradient(145deg,#101722,#080b10); }
    .processing-slate[hidden] { display:none; }
    .processing-id { font-size:14px;letter-spacing:.12em;font-weight:750; }
    .processing-status { max-width:80%;margin-top:12px;color:#8f9bad;font-size:10px;overflow-wrap:anywhere; }
  </style></head><body>
  <main data-fd-composition data-fd-id="${escapeHtml(options.id)}"
    data-fd-width="${options.width}" data-fd-height="${options.height}"
    data-fd-fps="${options.fps}" data-fd-duration="${options.durationInFrames}"
    data-fd-kind="scene" data-fd-output="${outputKind}" data-fd-library="true">
    ${media}
    <div class="processing-slate"${pinned ? " hidden" : ""}><div><div class="processing-id">PROCESS · ${escapeHtml(options.document.recipe.provenance.processor)}</div><div class="processing-status">${status}</div></div></div>
  </main></body></html>`;
  return Object.assign(defineComposition(source, {
    type: "processing",
    meta: {
      output: outputKind,
      file: options.file,
      module: options.file,
      sourceFormat: "generated",
      library: true,
      deps: options.dataFile ? [options.dataFile] : undefined,
      authoring: { timeline: "hidden", transport: "always", directManipulation: false },
    },
  }), {
    processing: options.document,
    processingDataFile: options.dataFile,
    processingOutputChannel: outputChannel,
  });
}
