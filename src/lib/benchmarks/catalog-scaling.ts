import path from "path";

export type CatalogScalingDatasetKey = "sample" | "100" | "1000" | "100000";

export interface CatalogScalingDataset {
  key: CatalogScalingDatasetKey;
  label: string;
  filePath: string;
  expectedRowCount: number;
}

export function getCatalogScalingDataset(selection: string): CatalogScalingDataset {
  const normalized = selection.trim().toLowerCase();

  switch (normalized) {
    case "sample":
      return {
        key: "sample",
        label: "sample (10 rows)",
        filePath: path.resolve(process.cwd(), "data/sample-challenge-v01.xlsx"),
        expectedRowCount: 10,
      };
    case "100":
      return {
        key: "100",
        label: "synthetic (100 rows)",
        filePath: path.resolve(process.cwd(), "data/synthetic-catalog-100.xlsx"),
        expectedRowCount: 100,
      };
    case "1000":
      return {
        key: "1000",
        label: "synthetic (1000 rows)",
        filePath: path.resolve(process.cwd(), "data/synthetic-catalog-1000.xlsx"),
        expectedRowCount: 1000,
      };
    case "100000":
      return {
        key: "100000",
        label: "synthetic (100000 rows)",
        filePath: path.resolve(process.cwd(), "data/synthetic-catalog-100000.xlsx"),
        expectedRowCount: 100000,
      };
    default:
      throw new Error(`Unknown dataset: "${selection}". Use sample, 100, 1000, or 100000.`);
  }
}

export function getCatalogScalingScenarios() {
  return {
    searchNaturalLanguage: { query: "nitrile gloves", limit: 5 },
    searchExactIdentifier: { query: "486803", limit: 1 },
    productDetailsInternalId: 1,
    basketRequest: {
      items: [
        { internalId: 1, quantity: 5, requestedUnit: "box" },
        { internalId: 3, quantity: 1, requestedUnit: "pack" },
      ],
      deliveryLocation: "Ward 3B",
      costCenter: "CC-4412",
      requestedByDate: "2026-06-01",
    },
  };
}
