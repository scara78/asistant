/**
 * Convert AI SDK v6 Data Stream SSE to OpenAI chat-completions SSE format.
 * Ported from Python api/converter/stream.py
 */

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function makeChunk(
  requestId: string,
  model: string,
  delta: Record<string, any>,
  finishReason: string | null = null,
  usage: Record<string, number> | null = null,
): string {
  const chunk: Record<string, any> = {
    id: requestId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  if (usage) chunk.usage = usage;
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Extract usage from a finish event.
 *
 * Upstream formats (checked in priority order):
 *  1. messageMetadata.usage       (current /api/chat)
 *  2. messageMetadata.custom.usage (legacy /api/doc/chat)
 */
function extractUsage(event: any): Record<string, number> | null {
  const meta = event.messageMetadata || {};
  let raw = meta.usage;
  if (!raw) raw = (meta.custom || {}).usage;
  if (!raw) return null;
  return {
    prompt_tokens: raw.promptTokens ?? raw.inputTokens ?? 0,
    completion_tokens: raw.completionTokens ?? raw.outputTokens ?? 0,
    total_tokens: raw.totalTokens ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Streaming conversion                                              */
/* ------------------------------------------------------------------ */

/**
 * Transform a ReadableStream of AI SDK v6 SSE lines into
 * a ReadableStream of OpenAI-compatible SSE strings.
 */
export function convertStreamToOpenAI(
  upstream: ReadableStream<Uint8Array>,
  model: string,
  requestId: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let roleSent = false;
  const toolCallsIndex: Record<string, number> = {};
  let nextToolIndex = 0;
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;

            if (line === "data: [DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }

            if (!line.startsWith("data: ")) continue;

            let event: any;
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            const eventType = event.type;

            // --- Text events ---
            if (eventType === "text-start") {
              if (!roleSent) {
                controller.enqueue(
                  encoder.encode(makeChunk(requestId, model, { role: "assistant", content: "" })),
                );
                roleSent = true;
              }
            } else if (eventType === "text-delta") {
              if (!roleSent) {
                controller.enqueue(
                  encoder.encode(makeChunk(requestId, model, { role: "assistant", content: "" })),
                );
                roleSent = true;
              }
              controller.enqueue(
                encoder.encode(makeChunk(requestId, model, { content: event.delta || "" })),
              );
            }

            // --- Tool call events ---
            else if (eventType === "tool-input-start") {
              const tcId = event.toolCallId || "";
              const toolName = event.toolName || "";
              const idx = nextToolIndex++;
              toolCallsIndex[tcId] = idx;

              const delta: Record<string, any> = {
                tool_calls: [{
                  index: idx,
                  id: tcId,
                  type: "function",
                  function: { name: toolName, arguments: "" },
                }],
              };
              if (!roleSent) {
                delta.role = "assistant";
                roleSent = true;
              }
              controller.enqueue(encoder.encode(makeChunk(requestId, model, delta)));
            } else if (eventType === "tool-input-delta") {
              const tcId = event.toolCallId || "";
              const idx = toolCallsIndex[tcId] ?? 0;
              controller.enqueue(
                encoder.encode(
                  makeChunk(requestId, model, {
                    tool_calls: [{
                      index: idx,
                      function: { arguments: event.inputTextDelta || "" },
                    }],
                  }),
                ),
              );
            }

            // --- Finish events ---
            else if (eventType === "finish") {
              let finishReason = event.finishReason || "stop";
              if (finishReason === "tool-calls") finishReason = "tool_calls";
              const usage = extractUsage(event);
              controller.enqueue(
                encoder.encode(makeChunk(requestId, model, {}, finishReason, usage)),
              );
            }
          }
        }

        // Flush remaining buffer
        if (buffer.trim()) {
          const line = buffer.trim();
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "finish") {
                let finishReason = event.finishReason || "stop";
                if (finishReason === "tool-calls") finishReason = "tool_calls";
                const usage = extractUsage(event);
                controller.enqueue(
                  encoder.encode(makeChunk(requestId, model, {}, finishReason, usage)),
                );
              }
            } catch { /* ignore */ }
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        const errorChunk = {
          id: requestId,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "error" }],
          error: { message: String(err), type: "upstream_error" },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Non-streaming helpers                                             */
/* ------------------------------------------------------------------ */

export interface ParsedResponse {
  content: string;
  toolCalls: any[];
  finishReason: string;
  usage: Record<string, number> | null;
}

/** Parse all SSE lines from a full response body into structured data. */
export function parseFullResponse(body: string): ParsedResponse {
  const contentParts: string[] = [];
  const toolCalls: any[] = [];
  const toolArgs: Record<string, string[]> = {};
  const toolMeta: Record<string, { name: string; id: string }> = {};
  let finishReason = "stop";
  let usage: Record<string, number> | null = null;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("data: ") || line === "data: [DONE]") continue;

    let event: any;
    try {
      event = JSON.parse(line.slice(6));
    } catch {
      continue;
    }

    const etype = event.type;

    if (etype === "text-delta") {
      contentParts.push(event.delta || "");
    } else if (etype === "tool-input-start") {
      const tcId = event.toolCallId || "";
      toolArgs[tcId] = [];
      toolMeta[tcId] = { name: event.toolName || "", id: tcId };
    } else if (etype === "tool-input-delta") {
      const tcId = event.toolCallId || "";
      if (!toolArgs[tcId]) toolArgs[tcId] = [];
      toolArgs[tcId].push(event.inputTextDelta || "");
    } else if (etype === "tool-input-available") {
      const tcId = event.toolCallId || "";
      const meta = toolMeta[tcId] || { name: event.toolName || "", id: tcId };
      toolCalls.push({
        id: meta.id,
        type: "function",
        function: {
          name: meta.name,
          arguments: JSON.stringify(event.input || {}),
        },
      });
    } else if (etype === "finish") {
      finishReason = event.finishReason || "stop";
      if (finishReason === "tool-calls") finishReason = "tool_calls";
      usage = extractUsage(event);
    }
  }

  // If we got tool-input-start/delta but no tool-input-available, build from deltas
  for (const [tcId, meta] of Object.entries(toolMeta)) {
    if (!toolCalls.some((tc: any) => tc.id === tcId)) {
      toolCalls.push({
        id: meta.id,
        type: "function",
        function: {
          name: meta.name,
          arguments: (toolArgs[tcId] || []).join(""),
        },
      });
    }
  }

  return {
    content: contentParts.join(""),
    toolCalls,
    finishReason,
    usage,
  };
}

/** Build a non-streaming chat.completions response object. */
export function buildNonStreamResponse(
  requestId: string,
  model: string,
  content: string,
  finishReason: string = "stop",
  usage: Record<string, number> | null = null,
  toolCalls?: any[] | null,
): Record<string, any> {
  const message: Record<string, any> = {
    role: "assistant",
    content: content || null,
  };
  if (toolCalls && toolCalls.length > 0) {
    message.tool_calls = toolCalls;
    if (!content) message.content = null;
  }
  return {
    id: requestId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
