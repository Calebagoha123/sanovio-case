import { tool } from "ai";
import { z } from "zod";
import { executeListReorderRequests } from "../../tools/list-reorder-requests";

export function createListReorderRequestsTool(sessionId: string) {
  return tool({
    description:
      "List all reorder requests created in the current session. Use this to answer 'what have I ordered?' questions.",
    inputSchema: z.object({}),
    execute: async () => {
      const requests = await executeListReorderRequests(sessionId);
      return { requests };
    },
  });
}
