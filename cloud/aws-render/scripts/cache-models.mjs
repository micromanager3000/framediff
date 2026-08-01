import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const outputRoot = resolve(process.argv[2] || "cloud/aws-render/harness/public/models");
const models = [
  {
    id: "onnx-community/depth-anything-v2-small",
    revision: "4472b7362082ad9968fee890ca0f1e5aca36b93d",
    files: ["config.json", "preprocessor_config.json", "quantize_config.json", "onnx/model.onnx"],
  },
  {
    id: "Xenova/segformer-b0-finetuned-ade-512-512",
    revision: "d3e5499fa8701ff0453ca940a8dfeae39b2f1504",
    files: ["config.json", "preprocessor_config.json", "quantize_config.json", "onnx/model.onnx"],
  },
];

const directFiles = [
  {
    path: "PeterL1n/RobustVideoMatting/rvm_mobilenetv3_fp32.onnx",
    url: "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx",
    sha256: "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828",
  },
];

for (const model of models) {
  for (const file of model.files) {
    const target = resolve(outputRoot, model.id, file);
    const url = `https://huggingface.co/${model.id}/resolve/${model.revision}/${file}`;
    process.stdout.write(`Caching ${model.id}/${file}\n`);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`Failed to cache ${url}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength < 16) throw new Error(`Model file was unexpectedly small: ${url}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

for (const file of directFiles) {
  const target = resolve(outputRoot, file.path);
  process.stdout.write(`Caching ${file.path}\n`);
  const response = await fetch(file.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Failed to cache ${file.url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== file.sha256) throw new Error(`Digest mismatch for ${file.url}: ${digest}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
