export const JOB_SPEC_VERSION = 1;
export const JOB_KINDS = ["capability-suite", "depth-map", "segmentation", "background-removal"];

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
  if (value.inputContentType != null && !["image/jpeg", "image/png", "image/webp"].includes(value.inputContentType)) {
    throw new Error("inputContentType must be image/jpeg, image/png, or image/webp.");
  }
  return {
    version: JOB_SPEC_VERSION,
    kind: value.kind,
    outputPrefix: validateRelativeKey(value.outputPrefix, "outputPrefix"),
    inputS3Key,
    inputContentType: inputS3Key ? value.inputContentType || undefined : undefined,
  };
}
