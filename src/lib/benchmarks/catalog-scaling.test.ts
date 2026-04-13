import { describe, expect, it } from "vitest";
import {
  getCatalogScalingDataset,
  getCatalogScalingScenarios,
} from "./catalog-scaling";

describe("getCatalogScalingDataset", () => {
  it("resolves the sample and synthetic datasets to known files and row counts", () => {
    expect(getCatalogScalingDataset("sample")).toMatchObject({
      key: "sample",
      expectedRowCount: 10,
    });
    expect(getCatalogScalingDataset("100")).toMatchObject({
      key: "100",
      expectedRowCount: 100,
    });
    expect(getCatalogScalingDataset("1000")).toMatchObject({
      key: "1000",
      expectedRowCount: 1000,
    });
    expect(getCatalogScalingDataset("100000")).toMatchObject({
      key: "100000",
      expectedRowCount: 100000,
    });
  });

  it("throws for an unknown dataset selection", () => {
    expect(() => getCatalogScalingDataset("42")).toThrow(/Unknown dataset/);
  });
});

describe("getCatalogScalingScenarios", () => {
  it("returns benchmark scenarios that match known seeded products", () => {
    expect(getCatalogScalingScenarios()).toMatchObject({
      searchNaturalLanguage: { query: "nitrile gloves", limit: 5 },
      searchExactIdentifier: { query: "486803", limit: 1 },
      productDetailsInternalId: 1,
      basketRequest: {
        items: [
          { internalId: 1, quantity: 5, requestedUnit: "box" },
          { internalId: 3, quantity: 1, requestedUnit: "pack" },
        ],
      },
    });
  });
});
