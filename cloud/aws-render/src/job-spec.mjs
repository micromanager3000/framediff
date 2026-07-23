export const JOB_SPEC_VERSION = 1;

export function validateJobSpec(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("FrameDiff cloud job spec must be an object.");
  }
  if (value.version !== JOB_SPEC_VERSION) {
    throw new Error(`Unsupported FrameDiff cloud job spec version: ${String(value.version)}`);
  }
  if (value.kind !== "capability-suite") {
    throw new Error(`Unsupported FrameDiff cloud job kind: ${String(value.kind)}`);
  }
  if (value.outputPrefix != null && (
    typeof value.outputPrefix !== "string"
    || value.outputPrefix.startsWith("/")
    || value.outputPrefix.includes("..")
  )) {
    throw new Error("outputPrefix must be a safe relative S3 prefix.");
  }
  return {
    version: JOB_SPEC_VERSION,
    kind: "capability-suite",
    outputPrefix: value.outputPrefix || undefined,
  };
}
