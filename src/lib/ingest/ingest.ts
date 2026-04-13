import * as XLSXModule from "xlsx";
import type { WorkBook } from "xlsx";
import { getServiceClient } from "../db/client";

const XLSX = (("default" in XLSXModule ? XLSXModule.default : XLSXModule) as typeof XLSXModule);

// German → English order unit normalization
const ORDER_UNIT_MAP: Record<string, string> = {
  box: "box",
  Box: "box",
  pack: "pack",
  Pack: "pack",
  stk: "pcs",
  Stk: "pcs",
  dose: "can",
  Dose: "can",
  rolle: "role",
  Rolle: "role",
};

// German → English base unit normalization
const BASE_UNIT_MAP: Record<string, string> = {
  stück: "Piece",
  Stück: "Piece",
  tuch: "Cloth",
  Tuch: "Cloth",
  rolle: "role",
  Rolle: "role",
};

const REQUIRED_COLUMNS = [
  "internal_id",
  "Artikelbezeichnung",
  "Marke",
  "Artikelnummer",
  "Jahresmenge",
  "Bestellmengeneinheit",
  "Basismengeneinheiten pro BME",
  "Basismengeneinheit",
  "GTIN",
  "MDR-Klasse",
  "Netto-Zielpreis",
  "Währung",
];

const INGEST_BATCH_SIZE = 1000;

function stripApostrophe(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  const stripped = s.startsWith("'") ? s.slice(1) : s;
  return stripped.length > 0 ? stripped : null;
}

function normalizeOrderUnit(raw: string): string {
  const trimmed = raw.trim();
  return ORDER_UNIT_MAP[trimmed] ?? trimmed.toLowerCase();
}

function normalizeBaseUnit(raw: string): string {
  const trimmed = raw.trim();
  return BASE_UNIT_MAP[trimmed] ?? trimmed;
}

function parseRequiredString(value: unknown, field: string, rowNumber: number): string {
  const parsed = String(value ?? "").trim();
  if (parsed.length === 0) {
    throw new Error(`Invalid value for "${field}" on row ${rowNumber}: expected a non-empty string`);
  }
  return parsed;
}

function parseRequiredInteger(
  value: unknown,
  field: string,
  rowNumber: number,
  options: { min?: number } = {}
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`Invalid value for "${field}" on row ${rowNumber}: expected an integer`);
  }
  if (options.min != null && parsed < options.min) {
    throw new Error(`Invalid value for "${field}" on row ${rowNumber}: expected >= ${options.min}`);
  }
  return parsed;
}

function parseOptionalInteger(
  value: unknown,
  field: string,
  rowNumber: number,
  options: { min?: number } = {}
): number | null {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  return parseRequiredInteger(value, field, rowNumber, options);
}

function parseOptionalDecimal(
  value: unknown,
  field: string,
  rowNumber: number,
  options: { min?: number } = {}
): number | null {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for "${field}" on row ${rowNumber}: expected a number`);
  }
  if (options.min != null && parsed < options.min) {
    throw new Error(`Invalid value for "${field}" on row ${rowNumber}: expected >= ${options.min}`);
  }
  return parsed;
}

function parseOptionalTrimmedString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const parsed = String(value).trim();
  return parsed.length > 0 ? parsed : null;
}

export function chunkRecords<T>(records: T[], batchSize: number): T[][] {
  if (batchSize <= 0) {
    throw new Error("batchSize must be greater than zero");
  }

  const batches: T[][] = [];
  for (let index = 0; index < records.length; index += batchSize) {
    batches.push(records.slice(index, index + batchSize));
  }
  return batches;
}

export async function ingestExcel(filePath: string): Promise<void> {
  let workbook: WorkBook;
  try {
    workbook = XLSX.readFile(filePath);
  } catch {
    throw new Error(`Cannot read Excel file: ${filePath}`);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  if (rows.length === 0) {
    throw new Error("Excel file contains no data rows");
  }

  // Validate required columns exist
  const headers = Object.keys(rows[0]);
  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) {
      throw new Error(`Missing required column: "${col}"`);
    }
  }

  const products = rows.map((row, index) => {
    const rowNumber = index + 2;
    return {
      internal_id: parseRequiredInteger(row["internal_id"], "internal_id", rowNumber, { min: 1 }),
      description: parseRequiredString(row["Artikelbezeichnung"], "Artikelbezeichnung", rowNumber),
      brand: parseRequiredString(row["Marke"], "Marke", rowNumber),
      supplier_article_no: parseOptionalTrimmedString(row["Artikelnummer"]),
      annual_quantity: parseOptionalInteger(row["Jahresmenge"], "Jahresmenge", rowNumber, { min: 0 }),
      order_unit: normalizeOrderUnit(
        parseRequiredString(row["Bestellmengeneinheit"], "Bestellmengeneinheit", rowNumber)
      ),
      base_units_per_bme: parseRequiredInteger(
        row["Basismengeneinheiten pro BME"],
        "Basismengeneinheiten pro BME",
        rowNumber,
        { min: 1 }
      ),
      base_unit: normalizeBaseUnit(
        parseRequiredString(row["Basismengeneinheit"], "Basismengeneinheit", rowNumber)
      ),
      gtin_ean: stripApostrophe(row["GTIN"]),
      mdr_class: parseOptionalTrimmedString(row["MDR-Klasse"]),
      net_target_price: parseOptionalDecimal(row["Netto-Zielpreis"], "Netto-Zielpreis", rowNumber, {
        min: 0,
      }),
      currency: parseRequiredString(row["Währung"], "Währung", rowNumber),
    };
  });

  const db = getServiceClient();
  const batches = chunkRecords(products, INGEST_BATCH_SIZE);

  for (const batch of batches) {
    const { error } = await db
      .from("products")
      .upsert(batch, { onConflict: "internal_id" });

    if (error) {
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }
  }
}
