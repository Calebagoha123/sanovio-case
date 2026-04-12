import * as XLSX from "xlsx";
import { getServiceClient } from "../db/client";

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

function stripApostrophe(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s.startsWith("'") ? s.slice(1) : s;
}

function normalizeOrderUnit(raw: string): string {
  const trimmed = raw.trim();
  return ORDER_UNIT_MAP[trimmed] ?? trimmed.toLowerCase();
}

function normalizeBaseUnit(raw: string): string {
  const trimmed = raw.trim();
  return BASE_UNIT_MAP[trimmed] ?? trimmed;
}

export async function ingestExcel(filePath: string): Promise<void> {
  let workbook: XLSX.WorkBook;
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

  const products = rows.map((row) => ({
    internal_id: Number(row["internal_id"]),
    description: String(row["Artikelbezeichnung"]).trim(),
    brand: String(row["Marke"]).trim(),
    supplier_article_no: row["Artikelnummer"]
      ? String(row["Artikelnummer"]).trim()
      : null,
    annual_quantity: row["Jahresmenge"] != null
      ? Math.round(Number(row["Jahresmenge"]))
      : null,
    order_unit: normalizeOrderUnit(String(row["Bestellmengeneinheit"])),
    base_units_per_bme: Math.round(
      Number(row["Basismengeneinheiten pro BME"])
    ),
    base_unit: normalizeBaseUnit(String(row["Basismengeneinheit"])),
    gtin_ean: stripApostrophe(row["GTIN"]),
    mdr_class: row["MDR-Klasse"] ? String(row["MDR-Klasse"]).trim() : null,
    net_target_price:
      row["Netto-Zielpreis"] != null
        ? parseFloat(String(row["Netto-Zielpreis"]))
        : null,
    currency: String(row["Währung"]).trim(),
  }));

  const db = getServiceClient();
  const { error } = await db
    .from("products")
    .upsert(products, { onConflict: "internal_id" });

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }
}
