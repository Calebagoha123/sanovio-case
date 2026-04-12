import { z } from "zod";
import { getServiceClient } from "../db/client";
import { logAgentEvent } from "../agent/logging";

export const searchCatalogInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(20).default(5),
});

export interface ProductSearchResult {
  internalId: number;
  description: string;
  brand: string;
  orderUnit: string;
  netTargetPrice: number | null;
  currency: string;
}

interface ProductSearchRow {
  internal_id: number;
  description: string;
  brand: string;
  order_unit: string;
  net_target_price: number | null;
  currency: string;
  supplier_article_no?: string | null;
}

// Synonym map: English (and German) → German search terms
// Keys are the user-supplied term, values expand the query
// Keys are matched against the lowercased user query.
// Values include the exact tokens that appear after `simple` tsvector tokenization
// of the German product descriptions (compound words are NOT split by `simple` config,
// so we must include the full compound word as a token alongside any fragments).
const SYNONYMS: Record<string, string[]> = {
  glove:    ["nitrilhandschuh", "einmalhandschuh", "handschuh", "latex", "nitril"],
  gloves:   ["nitrilhandschuh", "einmalhandschuh", "handschuh", "latex", "nitril"],
  nitrile:  ["nitrilhandschuh", "nitril"],
  latex:    ["einmalhandschuh", "latex"],
  needle:   ["kanüle", "nadel", "cannula", "sterican"],
  cannula:  ["kanüle", "sterican"],
  wipe:     ["desinfektionstücher", "tücher", "tuch", "mikrozid"],
  wipes:    ["desinfektionstücher", "tücher", "tuch", "mikrozid"],
  cloth:    ["desinfektionstücher", "tücher", "tuch"],
  disinfectant: ["desinfektionstücher", "desinfektions", "mikrozid"],
  syringe:  ["einmalspritze", "spritze", "luer"],
  syringes: ["einmalspritze", "spritze", "luer"],
  mask:     ["op-maske", "maske", "bindebändern"],
  infusion: ["infusionsbesteck", "intrafix"],
  urine:    ["urinbecher", "urin"],
  plaster:  ["wundpflaster", "pflaster", "elastic"],
  bandage:  ["verbandstoff", "verband"],
};

/**
 * Expand user query with synonyms.
 * Returns a websearch_to_tsquery-compatible string where expanded terms are OR'd.
 * e.g. "glove" → "glove OR handschuh OR nitril OR latex"
 */
function expandQuery(query: string): string {
  const lower = query.toLowerCase();
  const terms = new Set<string>([lower]);
  for (const [key, expansions] of Object.entries(SYNONYMS)) {
    if (lower.includes(key)) {
      for (const exp of expansions) terms.add(exp);
    }
  }
  // websearch_to_tsquery supports OR keyword to union terms
  return Array.from(terms).join(" OR ");
}

function scoreResult(row: ProductSearchRow, query: string): number {
  const haystack = `${row.description} ${row.brand} ${row.supplier_article_no ?? ""}`.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+| OR /)
    .map((term) => term.trim())
    .filter(Boolean);

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
      if (row.description.toLowerCase().includes(term)) score += 2;
      if (row.brand.toLowerCase().includes(term)) score += 1;
    }
  }
  return score;
}

/**
 * Natural-language search over the product catalog.
 * Returns up to `limit` ranked results.
 *
 * v1: Postgres FTS via Supabase + exact identifier short-circuit
 * v2: + pgvector dense retrieval + RRF fusion
 * v3: + cross-encoder reranker
 * None of these changes alter the input or output shape.
 */
export async function searchCatalog(
  input: z.infer<typeof searchCatalogInput>
): Promise<ProductSearchResult[]> {
  const startedAt = Date.now();
  const { query, limit } = input;
  const db = getServiceClient();

  // --- Exact identifier lookup first ---
  // Matches: pure integer (internal_id), 13–14 digit GTIN/EAN
  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) {
    if (trimmed.length <= 5) {
      // Likely internal_id
      const { data } = await db
        .from("products")
        .select("internal_id, description, brand, order_unit, net_target_price, currency")
        .eq("internal_id", parseInt(trimmed, 10))
        .limit(1);
      if (data && data.length > 0) {
        logAgentEvent("catalog_search_complete", {
          query,
          limit,
          exactMatch: "internal_id",
          durationMs: Date.now() - startedAt,
          resultCount: data.length,
        });
        return data.map(toSearchResult);
      }
    }
    if (trimmed.length >= 12) {
      // GTIN / EAN
      const { data } = await db
        .from("products")
        .select("internal_id, description, brand, order_unit, net_target_price, currency")
        .eq("gtin_ean", trimmed)
        .limit(1);
      if (data && data.length > 0) {
        logAgentEvent("catalog_search_complete", {
          query,
          limit,
          exactMatch: "gtin_ean",
          durationMs: Date.now() - startedAt,
          resultCount: data.length,
        });
        return data.map(toSearchResult);
      }
    }
  }

  const { data: articleMatches } = await db
    .from("products")
    .select("internal_id, description, brand, order_unit, net_target_price, currency, supplier_article_no")
    .eq("supplier_article_no", trimmed)
    .limit(1);
  if (articleMatches && articleMatches.length > 0) {
    logAgentEvent("catalog_search_complete", {
      query,
      limit,
      exactMatch: "supplier_article_no",
      durationMs: Date.now() - startedAt,
      resultCount: articleMatches.length,
    });
    return articleMatches.map((row) => toSearchResult(row as ProductSearchRow));
  }

  // --- Full-text search ---
  const expanded = expandQuery(trimmed);

  // Use Supabase's text search via .textSearch()
  const { data, error } = await db
    .from("products")
    .select("internal_id, description, brand, order_unit, net_target_price, currency, supplier_article_no")
    .textSearch("search_tsv", expanded, { config: "simple", type: "websearch" })
    .limit(limit);

  if (error) {
    logAgentEvent("catalog_search_failed", {
      query,
      limit,
      durationMs: Date.now() - startedAt,
      error: error.message,
    });
    throw new Error(`Search failed: ${error.message}`);
  }

  const results = ((data ?? []) as ProductSearchRow[])
    .sort((a, b) => scoreResult(b, expanded) - scoreResult(a, expanded))
    .slice(0, limit)
    .map(toSearchResult);

  logAgentEvent("catalog_search_complete", {
    query,
    limit,
    exactMatch: null,
    durationMs: Date.now() - startedAt,
    resultCount: results.length,
  });

  return results;
}

function toSearchResult(row: ProductSearchRow): ProductSearchResult {
  return {
    internalId: row.internal_id as number,
    description: row.description as string,
    brand: row.brand as string,
    orderUnit: row.order_unit as string,
    netTargetPrice: row.net_target_price as number | null,
    currency: row.currency as string,
  };
}
