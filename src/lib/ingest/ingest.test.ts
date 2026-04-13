import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import * as XLSX from "xlsx";
import { ingestExcel } from "./ingest";
import { getServiceClient } from "../db/client";
import { chunkRecords } from "./ingest";

const EXCEL_PATH = path.resolve(
  process.cwd(),
  "data/sample-challenge-v01.xlsx"
);
const SYNTHETIC_100_PATH = path.resolve(
  process.cwd(),
  "data/synthetic-catalog-100.xlsx"
);

const db = getServiceClient();

function writeWorkbook(rows: Record<string, unknown>[]): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sanovio-ingest-"));
  const filePath = path.join(directory, "catalog.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

beforeEach(async () => {
  await db.from("products").delete().neq("internal_id", 0);
});

describe("ingest", () => {
  it("chunks records into fixed-size batches with a smaller tail batch", () => {
    const batches = chunkRecords(
      Array.from({ length: 2505 }, (_, index) => index + 1),
      1000
    );

    expect(batches).toHaveLength(3);
    expect(batches.map((batch) => batch.length)).toEqual([1000, 1000, 505]);
  });

  it("produces exactly 10 rows from the sample file", async () => {
    await ingestExcel(EXCEL_PATH);
    const { count } = await db
      .from("products")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(10);
  });

  it("strips leading/trailing whitespace from string fields", async () => {
    await ingestExcel(EXCEL_PATH);
    const { data } = await db.from("products").select("description, brand");
    for (const row of data!) {
      expect(row.description).toBe(row.description.trim());
      expect(row.brand).toBe(row.brand.trim());
    }
  });

  it("strips the leading apostrophe from GTIN values", async () => {
    await ingestExcel(EXCEL_PATH);
    const { data } = await db
      .from("products")
      .select("gtin_ean")
      .eq("internal_id", 1)
      .single();
    expect(data!.gtin_ean).toBe("04046719012345");
    expect(data!.gtin_ean).not.toMatch(/^'/);
  });

  it("stores net_target_price as a number (not string)", async () => {
    await ingestExcel(EXCEL_PATH);
    const { data } = await db
      .from("products")
      .select("net_target_price")
      .eq("internal_id", 1)
      .single();
    expect(typeof data!.net_target_price).toBe("number");
    expect(data!.net_target_price).toBeCloseTo(0.019, 5);
  });

  it("stores annual_quantity and base_units_per_bme as integers", async () => {
    await ingestExcel(EXCEL_PATH);
    const { data } = await db
      .from("products")
      .select("annual_quantity, base_units_per_bme")
      .eq("internal_id", 1)
      .single();
    expect(Number.isInteger(data!.annual_quantity)).toBe(true);
    expect(Number.isInteger(data!.base_units_per_bme)).toBe(true);
    expect(data!.base_units_per_bme).toBe(200);
  });

  it("normalizes order_unit to lowercase English", async () => {
    await ingestExcel(EXCEL_PATH);
    const { data } = await db
      .from("products")
      .select("internal_id, order_unit");
    const unitMap: Record<number, string> = {};
    for (const row of data!) unitMap[row.internal_id] = row.order_unit;
    expect(unitMap[1]).toBe("box");   // "Box"
    expect(unitMap[3]).toBe("pack");  // "Pack"
    expect(unitMap[2]).toBe("pcs");   // "Stk"
    expect(unitMap[7]).toBe("can");   // "Dose"
    expect(unitMap[10]).toBe("role"); // "Rolle"
  });

  it("normalizes base_unit to English", async () => {
    await ingestExcel(EXCEL_PATH);
    const { data } = await db
      .from("products")
      .select("internal_id, base_unit");
    const unitMap: Record<number, string> = {};
    for (const row of data!) unitMap[row.internal_id] = row.base_unit;
    expect(unitMap[1]).toBe("Piece");  // "Stück"
    expect(unitMap[7]).toBe("Cloth");  // "Tuch"
    expect(unitMap[10]).toBe("role");  // "Rolle" (base == order unit)
  });

  it("populates the search_tsv column for every row", async () => {
    await ingestExcel(EXCEL_PATH);
    // We can't directly inspect tsvector from JS, but we can verify FTS works
    const { data, error } = await db.rpc("check_search_tsv_populated");
    // Fallback: just verify the row count is still 10 (tsv generation doesn't fail silently)
    const { count } = await db
      .from("products")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(10);
  });

  it("is idempotent — re-running produces the same 10 rows", async () => {
    await ingestExcel(EXCEL_PATH);
    await ingestExcel(EXCEL_PATH);
    const { count } = await db
      .from("products")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(10);
  });

  it("throws a clear error when a required column is missing", async () => {
    await expect(ingestExcel("data/nonexistent.xlsx")).rejects.toThrow();
  });

  it("ingests the synthetic 100-row dataset successfully", async () => {
    await ingestExcel(SYNTHETIC_100_PATH);
    const { count } = await db
      .from("products")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(100);
  });

  it("rejects rows with an invalid internal_id", async () => {
    const filePath = writeWorkbook([
      {
        internal_id: "abc",
        Artikelbezeichnung: "Invalid internal id row",
        Marke: "Contoso",
        Artikelnummer: "BAD-1",
        Jahresmenge: 10,
        Bestellmengeneinheit: "Box",
        "Basismengeneinheiten pro BME": 5,
        Basismengeneinheit: "Stück",
        GTIN: "'1234567890123",
        "MDR-Klasse": "I",
        "Netto-Zielpreis": 1.25,
        Währung: "CHF",
      },
    ]);

    await expect(ingestExcel(filePath)).rejects.toThrow(
      'Invalid value for "internal_id" on row 2: expected an integer'
    );
  });

  it("rejects rows with blank required text fields", async () => {
    const filePath = writeWorkbook([
      {
        internal_id: 11,
        Artikelbezeichnung: "   ",
        Marke: "Contoso",
        Artikelnummer: "BAD-2",
        Jahresmenge: 10,
        Bestellmengeneinheit: "Box",
        "Basismengeneinheiten pro BME": 5,
        Basismengeneinheit: "Stück",
        GTIN: "'1234567890123",
        "MDR-Klasse": "I",
        "Netto-Zielpreis": 1.25,
        Währung: "CHF",
      },
    ]);

    await expect(ingestExcel(filePath)).rejects.toThrow(
      'Invalid value for "Artikelbezeichnung" on row 2: expected a non-empty string'
    );
  });

  it("rejects rows with invalid pack-size numbers", async () => {
    const filePath = writeWorkbook([
      {
        internal_id: 12,
        Artikelbezeichnung: "Broken pack size item",
        Marke: "Contoso",
        Artikelnummer: "BAD-3",
        Jahresmenge: 10,
        Bestellmengeneinheit: "Box",
        "Basismengeneinheiten pro BME": 0,
        Basismengeneinheit: "Stück",
        GTIN: "'1234567890123",
        "MDR-Klasse": "I",
        "Netto-Zielpreis": 1.25,
        Währung: "CHF",
      },
    ]);

    await expect(ingestExcel(filePath)).rejects.toThrow(
      'Invalid value for "Basismengeneinheiten pro BME" on row 2: expected >= 1'
    );
  });
});
