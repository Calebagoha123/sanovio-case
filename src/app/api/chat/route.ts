import { NextRequest } from "next/server";
import type { ModelMessage } from "ai";
import { runAgentTurn } from "@/lib/agent/loop";
import { MODEL } from "@/lib/agent/agent";
import { executeCreateReorderRequest } from "@/lib/tools/create-reorder-request";
import { executeCancelReorderRequest } from "@/lib/tools/cancel-reorder-request";
import { createReorderRequestInput } from "@/lib/tools/create-reorder-request";
import { cancelReorderRequestInput } from "@/lib/tools/cancel-reorder-request";
import { logAgentEvent } from "@/lib/agent/logging";
import { createRequestTimer } from "@/lib/agent/logging";
import { formatUserFacingError } from "@/lib/agent/user-facing-errors";
import { getCurrentHospitalDate } from "@/lib/dates/resolve-requested-by-date";
import type { AgentUiArtifact, PendingApprovalPayload } from "@/lib/chat/ui-contract";

export interface ChatRequest {
  sessionId: string;
  timezone?: string;
  message: string;
  history: ModelMessage[];
  approve?: boolean;
  pendingToolCall?: PendingApprovalPayload;
}

interface ChatPayload {
  text: string;
  requiresApproval: boolean;
  pendingToolCall: PendingApprovalPayload | null;
  toolCallsMade: string[];
  toolErrors: string[];
  artifacts: AgentUiArtifact[];
  updatedHistory: ModelMessage[];
}

export type ChatStreamEvent =
  | { type: "assistant_chunk"; chunk: string }
  | { type: "approval"; payload: ChatPayload }
  | { type: "complete"; payload: ChatPayload }
  | { type: "error"; message: string };

const encoder = new TextEncoder();

function emitEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: ChatStreamEvent) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

function createPayload(args: ChatPayload): ChatPayload {
  return args;
}

function streamText(controller: ReadableStreamDefaultController<Uint8Array>, text: string) {
  const tokens = text.match(/\S+\s*/g) ?? [text];
  return (async () => {
    for (const token of tokens) {
      emitEvent(controller, { type: "assistant_chunk", chunk: token });
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
  })();
}

async function streamFriendlyCompletion(args: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  history: ModelMessage[];
  text: string;
  toolErrors?: string[];
}) {
  const payload = createPayload({
    text: args.text,
    requiresApproval: false,
    pendingToolCall: null,
    toolCallsMade: [],
    toolErrors: args.toolErrors ?? [],
    artifacts: [],
    updatedHistory: [
      ...args.history,
      { role: "assistant", content: args.text },
    ],
  });

  await streamText(args.controller, args.text);
  emitEvent(args.controller, { type: "complete", payload });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();
  const timer = createRequestTimer();
  const body: ChatRequest = await req.json();
  const { sessionId, message, history, approve, pendingToolCall, timezone = "Europe/Zurich" } =
    body as ChatRequest & { timezone?: string };

  logAgentEvent("chat_request_started", {
    requestId,
    sessionId,
    timezone,
    approve: Boolean(approve),
    hasPendingToolCall: Boolean(pendingToolCall),
    messageLength: message.length,
    historyLength: history.length,
  });

  if (!sessionId || typeof sessionId !== "string") {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (approve && pendingToolCall) {
          let resultText = "";
          let artifacts: AgentUiArtifact[] = [];

          if (pendingToolCall.toolName === "createReorderRequest") {
            const input = createReorderRequestInput.parse(pendingToolCall.toolInput);
            if (input.sessionId !== sessionId) {
              throw new Error("Pending create request does not belong to this session.");
            }
            if (input.timezone !== timezone) {
              throw new Error("Pending create request does not match the active timezone.");
            }
            const row = await executeCreateReorderRequest(input);
            logAgentEvent("tool_approval_executed", {
              sessionId,
              toolName: pendingToolCall.toolName,
              toolCallId: pendingToolCall.toolCallId,
              requestId: row.requestId,
            });
            resultText =
              `Reorder request created successfully.\n` +
              `Request ID: ${row.requestId}\n` +
              `Product: ${row.internalId} — ${row.quantity} ${row.orderUnit}\n` +
              `Deliver to: ${row.deliveryLocation} (${row.costCenter}) by ${row.requestedByDate}`;
            artifacts = [{ type: "created_request", request: row }];
          } else if (pendingToolCall.toolName === "cancelReorderRequest") {
            const input = cancelReorderRequestInput.parse(pendingToolCall.toolInput);
            if (input.sessionId !== sessionId) {
              throw new Error("Pending cancel request does not belong to this session.");
            }
            const row = await executeCancelReorderRequest(input.requestId, input.sessionId);
            logAgentEvent("tool_approval_executed", {
              sessionId,
              toolName: pendingToolCall.toolName,
              toolCallId: pendingToolCall.toolCallId,
              requestId: row.requestId,
            });
            resultText = `Reorder request ${row.requestId} has been cancelled.`;
            artifacts = [{ type: "cancelled_request", request: row }];
          } else {
            resultText = `Unknown tool: ${pendingToolCall.toolName}`;
          }

          const payload = createPayload({
            text: resultText,
            requiresApproval: false,
            pendingToolCall: null,
            toolCallsMade: [pendingToolCall.toolName],
            toolErrors: [],
            artifacts,
            updatedHistory: [
              ...history,
              { role: "assistant", content: resultText },
            ],
          });

          await streamText(controller, resultText);
          logAgentEvent("chat_request_completed", {
            requestId,
            sessionId,
            approve: true,
            durationMs: timer.elapsedMs(),
            requiresApproval: false,
            toolCallsMade: [pendingToolCall.toolName],
            toolErrors: [],
          });
          emitEvent(controller, { type: "complete", payload });
          controller.close();
          return;
        }

        const result = await runAgentTurn({
          model: MODEL,
          sessionId,
          timezone,
          userMessage: message,
          history,
        });

        const payload = createPayload({
          text: result.text,
          requiresApproval: result.requiresApproval,
          pendingToolCall: result.pendingToolCall,
          toolCallsMade: result.toolCallsMade,
          toolErrors: result.toolErrors,
          artifacts: result.artifacts,
          updatedHistory: result.updatedHistory,
        });

        if (result.requiresApproval) {
          logAgentEvent("chat_request_completed", {
            requestId,
            sessionId,
            approve: false,
            durationMs: timer.elapsedMs(),
            requiresApproval: true,
            toolCallsMade: result.toolCallsMade,
            toolErrors: result.toolErrors,
          });
          emitEvent(controller, { type: "approval", payload });
          controller.close();
          return;
        }

        await streamText(controller, result.text);
        logAgentEvent("chat_request_completed", {
          requestId,
          sessionId,
          approve: false,
          durationMs: timer.elapsedMs(),
          requiresApproval: false,
          toolCallsMade: result.toolCallsMade,
          toolErrors: result.toolErrors,
        });
        emitEvent(controller, { type: "complete", payload });
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const friendly = formatUserFacingError(msg, getCurrentHospitalDate());
        if (approve && pendingToolCall) {
          logAgentEvent("tool_approval_execution_failed", {
            sessionId,
            toolName: pendingToolCall.toolName,
            toolCallId: pendingToolCall.toolCallId,
            error: msg,
          });
        }
        if (friendly) {
          logAgentEvent("chat_request_failed", {
            requestId,
            sessionId,
            durationMs: timer.elapsedMs(),
            error: msg,
            friendly: true,
          });
          await streamFriendlyCompletion({
            controller,
            history,
            text: friendly,
            toolErrors: [msg],
          });
          controller.close();
          return;
        }
        logAgentEvent("chat_request_failed", {
          requestId,
          sessionId,
          durationMs: timer.elapsedMs(),
          error: msg,
          friendly: false,
        });
        emitEvent(controller, { type: "error", message: msg });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
