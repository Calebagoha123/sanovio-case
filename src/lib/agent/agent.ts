import { anthropic } from "@ai-sdk/anthropic";
import { searchCatalogTool } from "./tools/search-catalog-tool";
import { getProductDetailsTool } from "./tools/get-product-details-tool";
import { createListReorderRequestsTool } from "./tools/list-reorder-requests-tool";
import { createReorderRequestTool } from "./tools/create-reorder-request-tool";
import { cancelReorderRequestTool } from "./tools/cancel-reorder-request-tool";
import { SYSTEM_PROMPT } from "./system-prompt";

export const MODEL = anthropic("claude-sonnet-4-6");

export function createAgentTools(sessionId: string) {
  return {
    searchCatalog: searchCatalogTool,
    getProductDetails: getProductDetailsTool,
    listReorderRequests: createListReorderRequestsTool(sessionId),
    createReorderRequest: createReorderRequestTool,
    cancelReorderRequest: cancelReorderRequestTool,
  } as const;
}

export const AGENT_SYSTEM_PROMPT = SYSTEM_PROMPT;

// Maximum conversation turns before oldest non-system messages are truncated
export const MAX_HISTORY_TURNS = 20;
