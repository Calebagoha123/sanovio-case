import { tool } from "ai";
import { createReorderRequestProposalInput } from "../../tools/create-reorder-request";

export const createReorderRequestTool = tool({
  description:
    "Create a pending reorder request for a single product. Requires explicit user confirmation before execution. " +
    "The quantity can be in either the order unit (e.g. 'box') or the base unit (e.g. 'Piece'); the tool normalizes to the purchasing unit. " +
    "The requestedByDate can be a natural language phrase like 'tomorrow', 'next Monday', or an ISO date.",
  inputSchema: createReorderRequestProposalInput,
  // Write tool — pauses for explicit user confirmation before executing
  needsApproval: true,
});
