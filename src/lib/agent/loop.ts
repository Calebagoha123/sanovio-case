import { generateText, stepCountIs } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import { getAgentSystemPrompt, MAX_HISTORY_TURNS, createAgentTools } from "./agent";
import { buildPendingToolCall, type PendingToolCall } from "./pending-write";
import { logAgentEvent } from "./logging";
import { formatUserFacingError } from "./user-facing-errors";
import { getCurrentHospitalDate } from "../dates/resolve-requested-by-date";
import type { AgentUiArtifact } from "../chat/ui-contract";
import { buildUiArtifact } from "./ui-artifacts";

export interface AgentTurnResult {
  /** Final text response from the LLM (empty when requiresApproval is true) */
  text: string;
  /** Names of all tools called during this turn */
  toolCallsMade: string[];
  /** True if a write tool was intercepted and is awaiting user confirmation */
  requiresApproval: boolean;
  /** The pending write tool call details, if requiresApproval is true */
  pendingToolCall: PendingToolCall | null;
  /** Tool errors surfaced during this turn */
  toolErrors: string[];
  /** Structured UI artifacts derived from deterministic tool results */
  artifacts: AgentUiArtifact[];
  /** Updated message history for the next turn */
  updatedHistory: ModelMessage[];
}

export interface RunAgentTurnOptions {
  model: LanguageModel;
  sessionId: string;
  timezone?: string;
  userMessage: string;
  history: ModelMessage[];
  systemPromptOverride?: string;
}

function getMessageText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (
          typeof part === "object" &&
          part !== null &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }

        return "";
      })
      .join("\n");
  }

  return "";
}

function augmentOrderingIntentWithRecentProductContext(
  userMessage: string,
  history: ModelMessage[]
): string {
  const hasOrderingIntent = /\b(order|reorder|request)\b/i.test(userMessage);
  const hasExplicitCurrentProductReference =
    /\b(?:internal id|product)\s*#?\s*\d+\b/i.test(userMessage);
  const hasNamedProductInCurrentOrderMessage = mentionsNamedProductInOrderRequest(userMessage);

  if (
    !hasOrderingIntent ||
    hasExplicitCurrentProductReference ||
    hasNamedProductInCurrentOrderMessage
  ) {
    return userMessage;
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.role !== "user") {
      continue;
    }

    const text = getMessageText(message);
    const match = text.match(/\b(?:internal id|product)\s*#?\s*(\d+)\b/i);
    if (!match) {
      continue;
    }

    return `${userMessage}\n\nContext: the most recently referenced exact product in this conversation is internal ID ${match[1]}. Use a fresh tool lookup for that product and prefer it over prior assistant summaries if they conflict. If the current message already provides quantity and delivery metadata, continue directly to the write approval flow after confirming the product with tools.`;
  }

  return userMessage;
}

function mentionsNamedProductInOrderRequest(userMessage: string): boolean {
  const match = userMessage.match(/\b(?:order|reorder|request)\b\s+(.+)/i);
  if (!match) {
    return false;
  }

  const relevantSegment = match[1]
    .split(/\b(?:for|to|deliver(?:y)?|cost center|needed by|need(?:ed)? by|by)\b/i)[0]
    .trim();
  const words = relevantSegment.toLowerCase().match(/[a-z][a-z-]*/g) ?? [];

  if (words.length === 0) {
    return false;
  }

  const operationalWords = new Set([
    "a",
    "an",
    "the",
    "it",
    "this",
    "that",
    "please",
    "more",
    "another",
    "of",
    "box",
    "boxes",
    "pack",
    "packs",
    "piece",
    "pieces",
    "pcs",
    "can",
    "cans",
    "role",
    "roles",
  ]);

  return words.some((word) => !operationalWords.has(word));
}

function condenseArtifacts(artifacts: AgentUiArtifact[]): AgentUiArtifact[] {
  const keepAllTypes = new Set<AgentUiArtifact["type"]>(["search_results", "product_details"]);
  const latestByType = new Map<AgentUiArtifact["type"], AgentUiArtifact>();
  const preserved: AgentUiArtifact[] = [];

  for (const artifact of artifacts) {
    if (keepAllTypes.has(artifact.type)) {
      preserved.push(artifact);
      continue;
    }
    latestByType.set(artifact.type, artifact);
  }

  const orderedLatestTypes: AgentUiArtifact["type"][] = [
    "reorder_requests",
    "created_request",
    "created_basket_request",
    "cancelled_request",
  ];

  return [
    ...preserved,
    ...orderedLatestTypes
      .map((type) => latestByType.get(type))
      .filter((artifact): artifact is AgentUiArtifact => artifact !== undefined),
  ];
}

function stripArtifactsForWriteApproval(
  artifacts: AgentUiArtifact[],
  pendingToolName: PendingToolCall["toolName"]
): AgentUiArtifact[] {
  if (
    pendingToolName !== "createReorderRequest" &&
    pendingToolName !== "createBasketReorderRequest"
  ) {
    return artifacts;
  }

  return artifacts.filter((artifact) => artifact.type !== "product_details");
}

function stripArtifactsForOrderMetadataCollection(
  artifacts: AgentUiArtifact[],
  userMessage: string,
  text: string
): AgentUiArtifact[] {
  const orderingIntent = /\b(order|reorder|request)\b/i.test(userMessage);
  const collectingDeliveryMetadata =
    /delivery location/i.test(text) &&
    /cost center/i.test(text) &&
    /requested-by date|requested by date|need it by/i.test(text);

  if (!orderingIntent || !collectingDeliveryMetadata) {
    return artifacts;
  }

  return artifacts.filter((artifact) => artifact.type !== "product_details");
}

/**
 * Run one agent turn.
 *
 * Uses generateText with needsApproval: true on write tools (createReorderRequest,
 * cancelReorderRequest). When a write tool is invoked, the SDK stops the loop
 * without executing it and emits a "tool-approval-request" in the step content.
 * This function detects that state and returns requiresApproval: true.
 *
 * Read tools execute automatically within the generateText loop.
 */
export async function runAgentTurn({
  model,
  sessionId,
  timezone = "Europe/Zurich",
  userMessage,
  history,
  systemPromptOverride,
}: RunAgentTurnOptions): Promise<AgentTurnResult> {
  const trimmedHistory = trimHistory(history);
  const enrichedUserMessage = augmentOrderingIntentWithRecentProductContext(
    userMessage,
    trimmedHistory
  );
  const messagesForModel: ModelMessage[] = [
    ...trimmedHistory,
    { role: "user", content: enrichedUserMessage },
  ];
  const updatedHistoryBase: ModelMessage[] = [
    ...trimmedHistory,
    { role: "user", content: userMessage },
  ];

  let text = "";
  const toolCallsMade: string[] = [];
  const toolErrors: string[] = [];
  const artifacts: AgentUiArtifact[] = [];

  try {
    const modelStartedAt = Date.now();
    const result = await generateText({
      model,
      system: systemPromptOverride ?? getAgentSystemPrompt(timezone),
      messages: messagesForModel,
      tools: createAgentTools(sessionId),
      stopWhen: stepCountIs(5),
    });
    logAgentEvent("model_generation_complete", {
      sessionId,
      durationMs: Date.now() - modelStartedAt,
      stepCount: result.steps.length,
      textLength: (result.text ?? "").length,
    });

    text = result.text ?? "";

    // Collect tool names and errors from all steps
    for (const step of result.steps) {
      for (const tc of step.toolCalls ?? []) {
        toolCallsMade.push(tc.toolName);
        logAgentEvent("tool_call", {
          sessionId,
          toolName: tc.toolName,
          toolCallId: tc.toolCallId,
        });
      }
      for (const part of step.content ?? []) {
        if ((part as { type: string }).type === "tool-error") {
          const errPart = part as { type: "tool-error"; toolName: string; error: unknown };
          toolErrors.push(String(errPart.error));
          logAgentEvent("tool_error", {
            sessionId,
            toolName: errPart.toolName,
            error: String(errPart.error),
          });
        }
      }
      for (const tr of step.toolResults ?? []) {
        const artifact = buildUiArtifact({
          toolName: tr.toolName,
          input: tr.input,
          output: tr.output,
        });
        if (artifact) {
          artifacts.push(artifact);
        }
      }
      // Check for tool-approval-request in step content (write tool interception)
      const approvalRequests = (step.content ?? []).filter(
        (part: { type: string }) => part.type === "tool-approval-request"
      );
      if (approvalRequests.length > 0) {
        const req = approvalRequests[0] as {
          type: "tool-approval-request";
          approvalId: string;
          toolCall: { toolCallId: string; toolName: string; input: Record<string, unknown> };
        };
        try {
          const pendingToolCall = await buildPendingToolCall({
            toolCallId: req.toolCall.toolCallId,
            toolName: req.toolCall.toolName,
            rawInput: req.toolCall.input,
            sessionId,
            timezone,
          });
          logAgentEvent("tool_approval_requested", {
            sessionId,
            toolName: pendingToolCall.toolName,
            toolCallId: pendingToolCall.toolCallId,
          });
          return {
            text: "",
            toolCallsMade,
            requiresApproval: true,
            pendingToolCall,
            toolErrors,
            artifacts: condenseArtifacts(
              stripArtifactsForWriteApproval(artifacts, pendingToolCall.toolName)
            ),
            updatedHistory: updatedHistoryBase,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const friendly = formatUserFacingError(msg, getCurrentHospitalDate(timezone));
          toolErrors.push(msg);
          logAgentEvent("tool_approval_failed", {
            sessionId,
            toolName: req.toolCall.toolName,
            error: msg,
          });
          return {
            text: friendly ?? `I hit an operational issue while preparing that action: ${msg}`,
            toolCallsMade,
            requiresApproval: false,
            pendingToolCall: null,
            toolErrors,
            artifacts: condenseArtifacts(artifacts),
            updatedHistory: [
              ...updatedHistoryBase,
              {
                role: "assistant" as const,
                content: friendly ?? `I hit an operational issue while preparing that action: ${msg}`,
              },
            ],
          };
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toolErrors.push(msg);
    text = `An error occurred: ${msg}`;
    logAgentEvent("model_generation_failed", {
      sessionId,
      error: msg,
    });
    logAgentEvent("agent_turn_error", {
      sessionId,
      error: msg,
    });
  }

  logAgentEvent("agent_turn_complete", {
    sessionId,
    toolCallsMade,
    toolErrors,
    requiresApproval: false,
  });

  return {
    text,
    toolCallsMade,
    requiresApproval: false,
    pendingToolCall: null,
    toolErrors,
    artifacts: condenseArtifacts(
      stripArtifactsForOrderMetadataCollection(artifacts, userMessage, text)
    ),
    updatedHistory: [
      ...updatedHistoryBase,
      ...(text ? [{ role: "assistant" as const, content: text }] : []),
    ],
  };
}

function trimHistory(history: ModelMessage[]): ModelMessage[] {
  const nonSystem = history.filter((m) => m.role !== "system");
  if (nonSystem.length <= MAX_HISTORY_TURNS * 2) return history;
  return nonSystem.slice(-MAX_HISTORY_TURNS * 2);
}
