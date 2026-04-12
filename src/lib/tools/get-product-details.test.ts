import { describe, it, expect, beforeAll } from "vitest";
import { getProductDetails } from "./get-product-details";
import { ingestExcel } from "../ingest/ingest";
import { ProductNotFoundError } from "../errors";
import path from "path";

const EXCEL_PATH = path.resolve(process.cwd(), "data/sample-challenge-v01.xlsx");

beforeAll(async () => {
  await ingestExcel(EXCEL_PATH);
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
});
