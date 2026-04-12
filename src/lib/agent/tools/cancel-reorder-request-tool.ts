import { tool } from "ai";
import { cancelReorderRequestProposalInput } from "../../tools/cancel-reorder-request";

export const cancelReorderRequestTool = tool({
  description:
    "Cancel a pending reorder request by its request ID. Requires explicit user confirmation before execution. Only cancels requests from the current session.",
  inputSchema: cancelReorderRequestProposalInput,
  // Write tool — pauses for explicit user confirmation before executing
  needsApproval: true,
});
