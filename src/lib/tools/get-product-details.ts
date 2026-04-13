import { z } from "zod";
import { getServiceClient } from "../db/client";
import { ProductNotFoundError } from "../errors";
import { logAgentEvent } from "../agent/logging";

export const getProductDetailsInput = z.object({
  internalId: z.number().int().positive(),
});

export interface ProductDetails {
  internalId: number;
  description: string;
  brand: string;
  supplierArticleNo: string | null;
  gtinEan: string | null;
  orderUnit: string;
  baseUnit: string;
  baseUnitsPerBme: number;
  netTargetPrice: number | null;
  currency: string;
  annualQuantity: number | null;
  mdrClass: string | null;
}

export async function getProductDetails(
  internalId: number
): Promise<ProductDetails> {
  const startedAt = Date.now();
  const db = getServiceClient();
  const { data, error } = await db
    .from("products")
    .select("*")
    .eq("internal_id", internalId)
    .single();

  if (error || !data) {
    logAgentEvent("product_details_lookup_failed", {
      internalId,
      durationMs: Date.now() - startedAt,
      error: error?.message ?? `Product not found: ${internalId}`,
    });
    throw new ProductNotFoundError(internalId);
  }

  const row = data as Record<string, unknown>;
  const result = {
    internalId: row.internal_id as number,
    description: row.description as string,
    brand: row.brand as string,
    supplierArticleNo: row.supplier_article_no as string | null,
    gtinEan: row.gtin_ean as string | null,
    orderUnit: row.order_unit as string,
    baseUnit: row.base_unit as string,
    baseUnitsPerBme: row.base_units_per_bme as number,
    netTargetPrice: row.net_target_price as number | null,
    currency: row.currency as string,
    annualQuantity: row.annual_quantity as number | null,
    mdrClass: row.mdr_class as string | null,
  };

  logAgentEvent("product_details_lookup_complete", {
    internalId,
    durationMs: Date.now() - startedAt,
  });

  return result;
}
