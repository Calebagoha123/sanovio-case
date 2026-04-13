import type { ModelMessage } from "ai";
import type { AgentUiArtifact, PendingApprovalPayload } from "./ui-contract";

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
