import { tool } from "ai";
import { createReorderRequestProposalInput } from "../../tools/create-reorder-request";

export const createReorderRequestTool = tool({
  description:
    "Create a pending reorder request for a single product. Requires explicit user confirmation before execution. " +
    "Only call this after you already know the exact product, quantity, delivery location, cost center, and requested-by date. " +
    "If any of those delivery details are missing, ask the user for them first instead of calling the tool. " +
    "The quantity can be in either the order unit (e.g. 'box') or the base unit (e.g. 'Piece'); the tool normalizes to the purchasing unit. " +
    "The requestedByDate can be a natural language phrase like 'tomorrow', 'next Monday', or an ISO date.",
  inputSchema: createReorderRequestProposalInput,
  // Write tool — pauses for explicit user confirmation before executing
  needsApproval: true,
});
