import { HttpFolderCAS } from "../assets/httpCas";
import type { ProviderVoice } from "./devfs";
import type { Hash } from "../graph/hash";
import {
  applySourceEdit,
  deleteSecret,
  deleteSource,
  genJobs,
  genSubmit,
  getAssets,
  getSecrets,
  getProviderVoices,
  gitCommit,
  gitDirty,
  listCache,
  putSecret,
  readSource,
  readSourceRevision,
  uploadAsset,
  verifyProvider,
  writeArtifactMeta,
  writeSource,
  type AssetManifestJson,
  type GenJob,
  type GenTakeRow,
  type SecretsInfo,
  type SourceEditRequest,
  type SourceEditResponse,
  type StudioProjectRequest,
  type VerifyResult,
} from "./devfs";
import type { CacheEntry } from "./types";
import type { GenInputProvenance, GenPresentationSnapshot, GenProvider, GenRecipeSnapshot, GenRefKind } from "../generative";
import type { SourceFileRevisionSnapshot } from "@framediff/studio-model";

export interface GenerationSubmission {
  provider: GenProvider;
  gen: string;
  endpoint: string;
  recipeHash: string;
  input: Record<string, unknown>;
  refs: {
    kind: GenRefKind;
    src: string;
    authoredSrc: string;
    mime?: string;
    name?: string;
    field?: string;
    many?: boolean;
    adapt?: GenInputProvenance["adapt"];
  }[];
  recipe: GenRecipeSnapshot;
  presentation?: GenPresentationSnapshot;
}

/**
 * The complete persistence/service boundary used by Studio.
 *
 * FrameDiff ships an HTTP implementation for its local Vite plugin. Embedders can inject another
 * implementation without changing the rendering or editing engine, and without replacing global
 * browser APIs.
 */
export interface StudioProjectAdapter {
  readSourceRevision(file: string): Promise<SourceFileRevisionSnapshot | null>;
  readSource(file: string): Promise<string | null>;
  applySourceEdit(edit: SourceEditRequest): Promise<SourceEditResponse>;
  writeSource(file: string, text: string): Promise<boolean>;
  deleteSource(file: string): Promise<boolean>;
  listCache(): Promise<CacheEntry[]>;
  cacheUrl(key: string): string;
  readCache(key: Hash): Promise<Blob | null>;
  writeCache(key: Hash, blob: Blob, name?: string): Promise<void>;
  writeArtifactMeta(name: string, meta: unknown): Promise<void>;
  getAssets(): Promise<AssetManifestJson | null>;
  uploadAsset(file: File): Promise<string | null>;
  gitDirty(): Promise<string[] | null>;
  gitCommit(message: string): Promise<string | null>;
  getSecrets(): Promise<SecretsInfo | null>;
  getProviderVoices(): Promise<{ voices: ProviderVoice[] } | { error: string }>;
  putSecret(provider: string, key: string): Promise<{ ok: boolean; error?: string }>;
  deleteSecret(provider: string): Promise<{ ok: boolean; error?: string }>;
  verifyProvider(provider: string): Promise<VerifyResult>;
  submitGeneration(payload: GenerationSubmission): Promise<{ job?: GenJob; error?: string }>;
  getGenerationJobs(gen: string): Promise<{ jobs: GenJob[]; takes: GenTakeRow[] } | null>;
}

/** The standalone/local adapter backed by the FrameDiff Vite plugin HTTP contract. */
export function createHttpStudioProjectAdapter(
  request: StudioProjectRequest = globalThis.fetch.bind(globalThis),
  cacheBase = "/__framediff-cache",
): StudioProjectAdapter {
  const cache = new HttpFolderCAS(cacheBase, request);
  const cacheUrl = (key: string): string => `${cacheBase}/${encodeURIComponent(key)}`;
  return {
    readSourceRevision: (file) => readSourceRevision(file, request),
    readSource: (file) => readSource(file, request),
    applySourceEdit: (edit) => applySourceEdit(edit, request),
    writeSource: (file, text) => writeSource(file, text, request),
    deleteSource: (file) => deleteSource(file, request),
    listCache: () => listCache(request),
    cacheUrl,
    readCache: (key) => cache.get(key),
    writeCache: async (key, blob, name) => {
      await cache.put(key, blob, name);
    },
    writeArtifactMeta: (name, meta) => writeArtifactMeta(name, meta, request),
    getAssets: () => getAssets(request),
    uploadAsset: (file) => uploadAsset(file, request),
    gitDirty: () => gitDirty(request),
    gitCommit: (message) => gitCommit(message, request),
    getSecrets: () => getSecrets(request),
    getProviderVoices: () => getProviderVoices(request),
    putSecret: (provider, key) => putSecret(provider, key, request),
    deleteSecret: (provider) => deleteSecret(provider, request),
    verifyProvider: (provider) => verifyProvider(provider, request),
    submitGeneration: (payload) => genSubmit(payload, request),
    getGenerationJobs: (gen) => genJobs(gen, request),
  };
}
