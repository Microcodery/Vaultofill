// The on-device model, in two builds of the same Qwen2.5-1.5B-Instruct we tuned
// the labeling eval against. f16 is smaller/faster but needs the WebGPU
// `shader-f16` feature (absent on many Linux drivers / older GPUs, where its
// shaders fail to compile); f32 runs on any WebGPU device.
// VERIFY-AGAINST-INSTALLED: web-llm prebuilt model ids change across versions —
// confirm these are in the installed @mlc-ai/web-llm prebuiltAppConfig.
export const WEBLLM_MODEL_F16 = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
export const WEBLLM_MODEL_F32 = "Qwen2.5-1.5B-Instruct-q4f32_1-MLC";

/** Pick the model build for a GPU: f16 when it supports shader-f16, else the
 *  universally-compatible f32. */
export function pickModelId(shaderF16: boolean): string {
  return shaderF16 ? WEBLLM_MODEL_F16 : WEBLLM_MODEL_F32;
}
