import type { AgentUiArtifact } from "../chat/ui-contract";
import type { ReorderRequestRow } from "../db/reorder-requests";
import type { ProductDetails } from "../tools/get-product-details";
import type { ProductSearchResult } from "../tools/search-catalog";

function isSearchResults(output: unknown): output is { results: ProductSearchResult[] } {
  return (
    typeof output === "object" &&
    output !== null &&
    Array.isArray((output as { results?: unknown }).results)
  );
}

function isProductDetails(output: unknown): output is { product: ProductDetails } {
  return (
    typeof output === "object" &&
    output !== null &&
    typeof (output as { product?: unknown }).product === "object" &&
    (output as { product?: unknown }).product !== null
  );
}

function isReorderRequests(output: unknown): output is { requests: ReorderRequestRow[] } {
  return (
    typeof output === "object" &&
    output !== null &&
    Array.isArray((output as { requests?: unknown }).requests)
  );
}

export function buildUiArtifact(args: {
  toolName: string;
  input: unknown;
  output: unknown;
}): AgentUiArtifact | null {
  if (args.toolName === "searchCatalog" && isSearchResults(args.output)) {
    const query =
      typeof args.input === "object" &&
      args.input !== null &&
      typeof (args.input as { query?: unknown }).query === "string"
        ? (args.input as { query: string }).query
        : "catalog search";

    return {
      type: "search_results",
      query,
      results: args.output.results,
    };
  }

  if (args.toolName === "getProductDetails" && isProductDetails(args.output)) {
    return {
      type: "product_details",
      product: args.output.product,
    };
  }

  if (args.toolName === "listReorderRequests" && isReorderRequests(args.output)) {
    return {
      type: "reorder_requests",
      requests: args.output.requests,
    };
  }

  return null;
}
