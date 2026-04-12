import { tool } from "ai";
import { searchCatalogInput, searchCatalog } from "../../tools/search-catalog";

export const searchCatalogTool = tool({
  description:
    "Search the hospital product catalog using natural language. Returns up to `limit` ranked products. Use this before getting product details or creating reorder requests.",
  inputSchema: searchCatalogInput,
  execute: async (input) => {
    const results = await searchCatalog(input);
    return { results };
  },
});
