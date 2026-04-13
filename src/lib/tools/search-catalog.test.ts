import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { searchCatalog } from "./search-catalog";
import { ingestExcel } from "../ingest/ingest";
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

describe("searchCatalog", () => {
  it("returns at least products 1 and 8 for 'glove'", async () => {
    const results = await searchCatalog({ query: "glove", limit: 10 });
    const ids = results.map((r) => r.internalId);
    expect(ids).toContain(1);
    expect(ids).toContain(8);
  });

  it("returns multiple plausible matches for a vague query like 'gloves'", async () => {
    const results = await searchCatalog({ query: "gloves", limit: 10 });
    const ids = results.map((r) => r.internalId);
    expect(ids).toContain(1);
    expect(ids).toContain(8);
    expect(results.length).toBeGreaterThan(1);
  });

  it("returns product 1 first for 'nitrile'", async () => {
    const results = await searchCatalog({ query: "nitrile", limit: 5 });
    expect(results[0].internalId).toBe(1);
  });

  it("matches product 6 (Kanüle) for 'needle' via synonym expansion", async () => {
    const results = await searchCatalog({ query: "needle", limit: 5 });
    const ids = results.map((r) => r.internalId);
    expect(ids).toContain(6);
  });

  it("matches product 6 for 'cannula'", async () => {
    const results = await searchCatalog({ query: "cannula", limit: 5 });
    const ids = results.map((r) => r.internalId);
    expect(ids).toContain(6);
  });

  it("matches product 7 (Desinfektionstücher) for 'wipe'", async () => {
    const results = await searchCatalog({ query: "wipe", limit: 5 });
    const ids = results.map((r) => r.internalId);
    expect(ids).toContain(7);
  });

  it("returns empty array for a nonsense query, no error", async () => {
    const results = await searchCatalog({ query: "xyzzyplugh", limit: 5 });
    expect(results).toEqual([]);
  });

  it("returns at most `limit` results", async () => {
    const results = await searchCatalog({ query: "a", limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("keeps broad result sets capped at the requested limit", async () => {
    await ingestExcel(path.resolve(process.cwd(), "data/synthetic-catalog-100.xlsx"));
    const results = await searchCatalog({ query: "a", limit: 20 });
    expect(results).toHaveLength(20);
  });

  it("result shape matches documented schema", async () => {
    const results = await searchCatalog({ query: "glove", limit: 1 });
    expect(results[0]).toMatchObject({
      internalId: expect.any(Number),
      description: expect.any(String),
      brand: expect.any(String),
      orderUnit: expect.any(String),
      netTargetPrice: expect.any(Number),
      currency: expect.any(String),
    });
  });

  it("exact internal_id query returns the matching product", async () => {
    const results = await searchCatalog({ query: "3", limit: 5 });
    expect(results.some((r) => r.internalId === 3)).toBe(true);
  });

  it("exact GTIN query returns the matching product", async () => {
    // GTIN for product 1 (no apostrophe after ingest)
    const results = await searchCatalog({ query: "04046719012345", limit: 5 });
    expect(results[0].internalId).toBe(1);
  });

  it("exact supplier article query returns the matching product", async () => {
    const results = await searchCatalog({ query: "486803", limit: 5 });
    expect(results[0].internalId).toBe(1);
  });

  it("returns products with nullable optional pricing fields without crashing", async () => {
    await db.from("products").upsert({
      internal_id: 998,
      description: "Sample tray without price",
      brand: "Contoso",
      supplier_article_no: "NO-PRICE-998",
      gtin_ean: null,
      order_unit: "box",
      base_unit: "Piece",
      base_units_per_bme: 25,
      net_target_price: null,
      currency: "CHF",
      annual_quantity: null,
      mdr_class: null,
    }, { onConflict: "internal_id" });

    const results = await searchCatalog({ query: "998", limit: 1 });
    expect(results[0]).toMatchObject({
      internalId: 998,
      netTargetPrice: null,
      currency: "CHF",
    });
  });
});
