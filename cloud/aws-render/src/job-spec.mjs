export const JOB_SPEC_VERSION = 1;
export const JOB_KINDS = ["capability-suite", "depth-map", "segmentation", "background-removal", "hosted-render"];

function validateHostedRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("hosted-render requires renderRequest.");
  }
  const files = value.source?.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error("hosted-render requires an immutable source file map.");
  }
  const entries = Object.entries(files);
  if (!entries.length || entries.length > 500) throw new Error("hosted-render source file count is invalid.");
  let encodedBytes = 0;
  for (const [path, file] of entries) {
    validateRelativeKey(path, "source file path");
    if (!file || typeof file !== "object" || Array.isArray(file)
      || typeof file.contentBase64 !== "string"
      || !/^sha256:[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`hosted-render source file is invalid: ${path}`);
    }
    encodedBytes += file.contentBase64.length;
  }
  if (encodedBytes > 32 * 1024 * 1024) throw new Error("hosted-render source bundle is too large.");
  const settings = value.settings;
  if (!settings || typeof settings !== "object"
    || !Number.isInteger(settings.width) || settings.width <= 0 || settings.width > 7680
    || !Number.isInteger(settings.height) || settings.height <= 0 || settings.height > 4320
    || !Number.isInteger(settings.from) || settings.from < 0
    || !Number.isInteger(settings.to) || settings.to <= settings.from
    || !["video", "image"].includes(settings.outputKind)) {
    throw new Error("hosted-render settings are invalid.");
  }
  if (typeof value.compositionKey !== "string" || !value.compositionKey || value.compositionKey.length > 255) {
    throw new Error("hosted-render compositionKey is invalid.");
  }
  return value;
}

function validateRelativeKey(value, field) {
  if (value != null && (
    typeof value !== "string"
    || value.length === 0
    || value.startsWith("/")
    || value.includes("..")
  )) {
    throw new Error(`${field} must be a safe relative S3 key.`);
  }
  return value || undefined;
}

export function validateJobSpec(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("FrameDiff cloud job spec must be an object.");
  }
  if (value.version !== JOB_SPEC_VERSION) {
    throw new Error(`Unsupported FrameDiff cloud job spec version: ${String(value.version)}`);
  }
  if (!JOB_KINDS.includes(value.kind)) {
    throw new Error(`Unsupported FrameDiff cloud job kind: ${String(value.kind)}`);
  }
  const inputS3Key = validateRelativeKey(value.inputS3Key, "inputS3Key");
  if (value.kind === "capability-suite" && inputS3Key) {
    throw new Error("capability-suite jobs do not accept inputS3Key.");
  }
  if (value.kind === "hosted-render" && inputS3Key) {
    throw new Error("hosted-render jobs do not accept inputS3Key.");
  }
  if (value.inputContentType != null && !["image/jpeg", "image/png", "image/webp"].includes(value.inputContentType)) {
    throw new Error("inputContentType must be image/jpeg, image/png, or image/webp.");
  }
  return {
    version: JOB_SPEC_VERSION,
    kind: value.kind,
    outputPrefix: validateRelativeKey(value.outputPrefix, "outputPrefix"),
    inputS3Key,
    inputContentType: inputS3Key ? value.inputContentType || undefined : undefined,
    renderRequest: value.kind === "hosted-render" ? validateHostedRequest(value.renderRequest) : undefined,
  };
}
