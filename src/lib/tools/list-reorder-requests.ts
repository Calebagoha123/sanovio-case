import { z } from "zod";
import { listReorderRequests } from "../db/reorder-requests";
import type { ReorderRequestRow } from "../db/reorder-requests";

export const listReorderRequestsInput = z.object({
  sessionId: z.string().uuid(),
});

export async function executeListReorderRequests(
  sessionId: string
): Promise<ReorderRequestRow[]> {
  return listReorderRequests(sessionId);
}
