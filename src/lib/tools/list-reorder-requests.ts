import { z } from "zod";
import { listReorderRequests } from "../db/reorder-requests";
import type { ReorderRequestRow } from "../db/reorder-requests";
import { logAgentEvent } from "../agent/logging";

export const listReorderRequestsInput = z.object({
  sessionId: z.string().uuid(),
});

export async function executeListReorderRequests(
  sessionId: string
): Promise<ReorderRequestRow[]> {
  const startedAt = Date.now();
  try {
    const requests = await listReorderRequests(sessionId);
    logAgentEvent("list_reorder_requests_complete", {
      sessionId,
      durationMs: Date.now() - startedAt,
      resultCount: requests.length,
    });
    return requests;
  } catch (error) {
    logAgentEvent("list_reorder_requests_failed", {
      sessionId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
