import browser from "webextension-polyfill";
import type { WebLlmChatEngine } from "../../core/planner/webLlmModelClient";
import { OffscreenChatMsg, OffscreenChatReply } from "../offscreen/offscreenMessages";

/**
 * A WebLlmChatEngine that runs inference in the background offscreen document
 * (Chrome) via runtime messaging, instead of loading the model in the panel.
 * Wrapped in a WebLlmModelClient just like the local engine, so the fill
 * pipeline is agnostic to where the model actually runs.
 */
export class OffscreenChatEngine implements WebLlmChatEngine {
  async chatCompletion(params: { messages: { role: string; content: string }[]; temperature: number }): Promise<string> {
    const reply = (await browser.runtime.sendMessage({
      kind: "vof:offscreen:chat",
      messages: params.messages,
      temperature: params.temperature,
    } satisfies OffscreenChatMsg)) as OffscreenChatReply | undefined;
    if (!reply || reply.error !== undefined || reply.text === undefined) {
      throw new Error(reply?.error ?? "No response from the offscreen model");
    }
    return reply.text;
  }
}
