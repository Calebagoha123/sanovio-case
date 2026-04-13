import type { AgentUiArtifact, PendingApprovalPayload } from "../chat/ui-contract";

export const APPROVAL_TTL_MS = 10 * 60 * 1000;

export interface ApprovalExecutionResult {
  text: string;
  artifacts: AgentUiArtifact[];
  toolCallsMade: string[];
  reused: boolean;
}

interface CompletedExecution {
  status: "completed";
  expiresAt: number;
  result: Omit<ApprovalExecutionResult, "reused">;
}

interface ProcessingExecution {
  status: "processing";
  expiresAt: number;
  promise: Promise<Omit<ApprovalExecutionResult, "reused">>;
}

type ApprovalExecutionEntry = CompletedExecution | ProcessingExecution;

const executionRegistry = new Map<string, ApprovalExecutionEntry>();

function pruneExpiredExecutions(now: number): void {
  for (const [toolCallId, entry] of executionRegistry.entries()) {
    if (entry.expiresAt <= now) {
      executionRegistry.delete(toolCallId);
    }
  }
}

export function createApprovalExpiry(now = Date.now()): {
  createdAt: string;
  expiresAt: string;
} {
  return {
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + APPROVAL_TTL_MS).toISOString(),
  };
}

export function isPendingApprovalExpired(
  pendingToolCall: Pick<PendingApprovalPayload, "expiresAt">,
  now = Date.now()
): boolean {
  return Number.isNaN(Date.parse(pendingToolCall.expiresAt))
    ? true
    : Date.parse(pendingToolCall.expiresAt) <= now;
}

export async function executeApprovalOnce(
  toolCallId: string,
  executor: () => Promise<Omit<ApprovalExecutionResult, "reused">>,
  now = Date.now()
): Promise<ApprovalExecutionResult> {
  pruneExpiredExecutions(now);

  const existing = executionRegistry.get(toolCallId);
  if (existing) {
    if (existing.status === "completed") {
      return { ...existing.result, reused: true };
    }

    const result = await existing.promise;
    return { ...result, reused: true };
  }

  const expiresAt = now + APPROVAL_TTL_MS;
  const promise = executor()
    .then((result) => {
      executionRegistry.set(toolCallId, {
        status: "completed",
        expiresAt,
        result,
      });
      return result;
    })
    .catch((error) => {
      executionRegistry.delete(toolCallId);
      throw error;
    });

  executionRegistry.set(toolCallId, {
    status: "processing",
    expiresAt,
    promise,
  });

  const result = await promise;
  return { ...result, reused: false };
}

export function resetApprovalExecutionRegistry(): void {
  executionRegistry.clear();
}
