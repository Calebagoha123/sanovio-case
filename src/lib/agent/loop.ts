import { generateText, stepCountIs } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import { AGENT_SYSTEM_PROMPT, MAX_HISTORY_TURNS, createAgentTools } from "./agent";
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
}

function condenseArtifacts(artifacts: AgentUiArtifact[]): AgentUiArtifact[] {
  const latestByType = new Map<AgentUiArtifact["type"], AgentUiArtifact>();

  for (const artifact of artifacts) {
    latestByType.set(artifact.type, artifact);
  }

  const orderedTypes: AgentUiArtifact["type"][] = [
    "search_results",
    "product_details",
    "reorder_requests",
    "created_request",
    "cancelled_request",
  ];

  return orderedTypes
    .map((type) => latestByType.get(type))
    .filter((artifact): artifact is AgentUiArtifact => artifact !== undefined);
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
}: RunAgentTurnOptions): Promise<AgentTurnResult> {
  const trimmedHistory = trimHistory(history);
  const messages: ModelMessage[] = [
    ...trimmedHistory,
    { role: "user", content: userMessage },
  ];

  let text = "";
  const toolCallsMade: string[] = [];
  const toolErrors: string[] = [];
  const artifacts: AgentUiArtifact[] = [];

  try {
    const result = await generateText({
      model,
      system: AGENT_SYSTEM_PROMPT,
      messages,
      tools: createAgentTools(sessionId),
      stopWhen: stepCountIs(5),
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
            artifacts: condenseArtifacts(artifacts),
            updatedHistory: messages,
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
              ...messages,
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
    artifacts: condenseArtifacts(artifacts),
    updatedHistory: [
      ...messages,
      ...(text ? [{ role: "assistant" as const, content: text }] : []),
    ],
  };
}

function trimHistory(history: ModelMessage[]): ModelMessage[] {
  const nonSystem = history.filter((m) => m.role !== "system");
  if (nonSystem.length <= MAX_HISTORY_TURNS * 2) return history;
  return nonSystem.slice(-MAX_HISTORY_TURNS * 2);
}
