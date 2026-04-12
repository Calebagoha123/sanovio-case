import { z } from "zod";
import { cancelReorderRequest } from "../db/reorder-requests";
import type { ReorderRequestRow } from "../db/reorder-requests";

export const cancelReorderRequestProposalInput = z.object({
  requestId: z.string().uuid(),
});

export const cancelReorderRequestInput = cancelReorderRequestProposalInput.extend({
  requestId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

export async function executeCancelReorderRequest(
  requestId: string,
  sessionId: string
): Promise<ReorderRequestRow> {
  return cancelReorderRequest(requestId, sessionId);
}
