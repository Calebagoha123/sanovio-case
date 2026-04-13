import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { getProductDetails } from "./get-product-details";
import { ingestExcel } from "../ingest/ingest";
import { ProductNotFoundError } from "../errors";
import { getServiceClient } from "../db/client";
import path from "path";

const EXCEL_PATH = path.resolve(process.cwd(), "data/sample-challenge-v01.xlsx");
const db = getServiceClient();

beforeAll(async () => {
  await db.from("products").delete().neq("internal_id", 0);
  await ingestExcel(EXCEL_PATH);
});

afterAll(async () => {
  await db.from("products").delete().neq("internal_id", 0);
  await ingestExcel(EXCEL_PATH);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getProductDetails", () => {
  it("returns the full record for a valid internal_id", async () => {
    const result = await getProductDetails(4);
    expect(result.internalId).toBe(4);
    expect(result.description).toContain("Intrafix");
    expect(result.brand).toBe("B. Braun");
    expect(result.orderUnit).toBe("pcs");
    expect(result.baseUnit).toBe("Piece");
    expect(result.baseUnitsPerBme).toBe(1);
    expect(result.mdrClass).toBe("IIa");
    expect(result.currency).toBe("CHF");
  });

  it("returns unit hierarchy fields", async () => {
    const result = await getProductDetails(1);
    expect(result.orderUnit).toBe("box");
    expect(result.baseUnit).toBe("Piece");
    expect(result.baseUnitsPerBme).toBe(200);
  });

  it("throws ProductNotFoundError for a non-existent id", async () => {
    await expect(getProductDetails(9999)).rejects.toThrow(ProductNotFoundError);
  });

  it("handles rows with missing optional product metadata", async () => {
    await db.from("products").upsert({
      internal_id: 999,
      description: "Fallback sample item",
      brand: "Contoso",
      supplier_article_no: null,
      gtin_ean: null,
      order_unit: "box",
      base_unit: "Piece",
      base_units_per_bme: 10,
      net_target_price: null,
      currency: "CHF",
      annual_quantity: null,
      mdr_class: null,
    }, { onConflict: "internal_id" });

    const result = await getProductDetails(999);
    expect(result.supplierArticleNo).toBeNull();
    expect(result.gtinEan).toBeNull();
    expect(result.netTargetPrice).toBeNull();
    expect(result.annualQuantity).toBeNull();
    expect(result.mdrClass).toBeNull();
  });

  it("logs lookup timing and identity metadata", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await getProductDetails(4);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"product_details_lookup_complete"')
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('"internalId":4')
    );
  });
});
