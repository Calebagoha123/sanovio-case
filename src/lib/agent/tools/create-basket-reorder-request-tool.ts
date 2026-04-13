import { tool } from "ai";
import { createBasketReorderRequestProposalInput } from "../../tools/create-basket-reorder-request";

export const createBasketReorderRequestTool = tool({
  description:
    "Create a pending reorder basket for multiple products that share the same delivery location, cost center, and requested-by date. " +
    "Only call this after you already know the quantity for each line plus the shared delivery location, cost center, and requested-by date. " +
    "If any of that shared delivery metadata is missing, ask the user for it first instead of calling the tool. " +
    "Requires explicit user confirmation before execution. Each line item can use either the order unit or base unit; the tool normalizes each line to the purchasing unit.",
  inputSchema: createBasketReorderRequestProposalInput,
  needsApproval: true,
});
