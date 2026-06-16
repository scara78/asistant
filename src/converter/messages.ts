/**
 * Convert between OpenAI chat format and AI SDK v6 format.
 * Ported from Python api/converter/messages.py
 */

import { ACTIVE_MODELS, DEFAULT_MODEL, MAX_SYSTEM_LENGTH, MODEL_MAP } from "../config";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Generate a nanoid-style random string. */
export function genId(prefix: string = "msg", size: number = 12): string {
  const arr = crypto.getRandomValues(new Uint8Array(size));
  const id = Array.from(arr, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${prefix}_${id}`;
}

/** Map short model name to assistant-ui API identifier. */
function resolveModel(model: string): string {
  if (model in MODEL_MAP) {
    const info = MODEL_MAP[model];
    if (info.disabled) return ACTIVE_MODELS[DEFAULT_MODEL];
    return info.id;
  }
  if (model.includes("/")) return model;
  return `openai/${model}`;
}

/** Infer media type from a data-URI or file extension. */
function guessMediaType(url: string): string {
  if (url.startsWith("data:")) {
    const header = url.split(",", 1)[0];
    if (header.includes(";")) return header.slice(5).split(";")[0];
    return header.slice(5);
  }
  const lower = url.toLowerCase();
  const extMap: [string, string][] = [
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".svg", "image/svg+xml"],
  ];
  for (const [ext, mt] of extMap) {
    if (lower.includes(ext)) return mt;
  }
  return "image/png";
}

/**
 * Convert OpenAI tools list to AI SDK frontend tools format.
 *
 * OpenAI: [{"type":"function","function":{"name":"...","description":"...","parameters":{...}}}]
 * AI SDK: {"tool_name":{"description":"...","parameters":{...}}}
 */
function convertTools(tools: any[] | null | undefined): Record<string, any> {
  if (!tools || tools.length === 0) return {};
  const result: Record<string, any> = {};
  for (const tool of tools) {
    if (tool.type !== "function") continue;
    const func = tool.function || {};
    const name = func.name;
    if (!name) continue;
    const entry: Record<string, any> = {
      parameters: func.parameters || { type: "object" },
    };
    if (func.description) entry.description = func.description;
    result[name] = entry;
  }
  return result;
}

/** Convert an OpenAI chat-completions request to AI SDK v6 payload. */
export function openaiToAiSdk(
  messages: any[],
  model: string,
  tools?: any[] | null,
): Record<string, any> {
  const sdkMessages: any[] = [];
  let systemText = "";

  for (const msg of messages) {
    const role = msg.role || "";
    const content = msg.content ?? "";

    if (role === "system") {
      const text = typeof content === "string" ? content : "";
      if (text) systemText = text.slice(0, MAX_SYSTEM_LENGTH);
      continue;
    }

    if (role === "user") {
      let parts: any[];
      if (Array.isArray(content)) {
        parts = [];
        for (const part of content) {
          if (typeof part === "string") {
            parts.push({ type: "text", text: part });
          } else if (typeof part === "object" && part !== null) {
            const ptype = part.type || "";
            if (ptype === "text") {
              parts.push({ type: "text", text: part.text });
            } else if (ptype === "image_url") {
              const img = part.image_url || {};
              const url = typeof img === "object" ? (img.url || "") : String(img);
              const mediaType = guessMediaType(url);
              parts.push({ type: "file", mediaType, url });
            }
          }
        }
      } else {
        parts = [{ type: "text", text: String(content) }];
      }
      sdkMessages.push({
        role: "user",
        parts,
        metadata: { custom: {} },
        id: genId("msg"),
      });
    } else if (role === "assistant") {
      const parts: any[] = [];
      // Text content
      if (typeof content === "string" && content) {
        parts.push({ type: "text", text: content });
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part === "object" && part?.type === "text") {
            parts.push({ type: "text", text: part.text });
          }
        }
      }
      // Tool calls -> tool-invocation parts
      const toolCalls = msg.tool_calls || [];
      for (const tc of toolCalls) {
        const func = tc.function || {};
        let args: any = {};
        try {
          args = JSON.parse(func.arguments || "{}");
        } catch {
          args = {};
        }
        parts.push({
          type: "tool-invocation",
          toolCallId: tc.id || genId("call"),
          toolName: func.name || "",
          input: args,
          state: "input-available",
        });
      }
      sdkMessages.push({
        role: "assistant",
        parts,
        metadata: { custom: {} },
        id: genId("msg"),
      });
    } else if (role === "tool") {
      // Tool result - attach output to matching tool-invocation in preceding assistant msg
      const toolCallId = msg.tool_call_id || "";
      let resultObj: any;
      if (typeof content === "string") {
        try {
          resultObj = JSON.parse(content);
        } catch {
          resultObj = content;
        }
      } else {
        resultObj = content;
      }
      for (let i = sdkMessages.length - 1; i >= 0; i--) {
        const prev = sdkMessages[i];
        if (prev.role !== "assistant") continue;
        for (const part of prev.parts) {
          if (part.type === "tool-invocation" && part.toolCallId === toolCallId) {
            part.state = "output-available";
            part.output = resultObj;
            break;
          }
        }
        break;
      }
    }
  }

  return {
    system: systemText,
    config: { modelName: resolveModel(model) },
    tools: convertTools(tools),
    id: genId("thread"),
    messages: sdkMessages,
    trigger: "submit-message",
    metadata: {},
  };
}
