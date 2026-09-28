// Downloads the voice filter's on-device models (sherpa-onnx releases, Apache
// 2.0 / MIT) into resources/voice-models and checks their SHA-256 so a build
// always ships the files the filter was tuned with.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = "https://github.com/k2-fsa/sherpa-onnx/releases/download";
const models = [
  {
    name: "dpdfnet2_48khz_hr.onnx",
    url: `${base}/speech-enhancement-models/dpdfnet2_48khz_hr.onnx`,
    sha256: "0b399f8a58dc4d70d8cd97541f5c39869406145193b957d00a03b66070944928",
  },
  {
    name: "campplus_zh_en.onnx",
    url: `${base}/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`,
    sha256: "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
  },
  {
    name: "silero_vad.onnx",
    url: `${base}/asr-models/silero_vad.onnx`,
    sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
  },
];

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "resources", "voice-models");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

await mkdir(directory, { recursive: true });
for (const model of models) {
  const target = path.join(directory, model.name);
  const existing = await readFile(target).catch(() => null);
  if (existing && sha256(existing) === model.sha256) {
    console.log(`${model.name}: up to date`);
    continue;
  }
  console.log(`${model.name}: downloading`);
  const response = await fetch(model.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${model.name}: download failed (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== model.sha256) throw new Error(`${model.name}: checksum mismatch`);
  await writeFile(`${target}.part`, data);
  await rename(`${target}.part`, target);
  console.log(`${model.name}: saved (${(data.length / 1e6).toFixed(1)} MB)`);
}
