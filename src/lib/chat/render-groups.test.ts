import { describe, expect, it } from "vitest";
import type { AgentUiArtifact } from "./ui-contract";
import { groupArtifactsForRender } from "./render-groups";

const detail1: AgentUiArtifact = {
  type: "product_details",
  product: {
    internalId: 1,
    description: "Glove",
    brand: "Brand A",
    supplierArticleNo: null,
    gtinEan: null,
    orderUnit: "box",
    baseUnit: "Piece",
    baseUnitsPerBme: 200,
    netTargetPrice: 0.019,
    currency: "CHF",
    annualQuantity: 4000,
    mdrClass: "I",
  },
};

const detail2: AgentUiArtifact = {
  ...detail1,
  product: {
    ...detail1.product,
    internalId: 3,
    description: "Syringe",
    brand: "Brand B",
    orderUnit: "pack",
    baseUnitsPerBme: 100,
  },
};

const search: AgentUiArtifact = {
  type: "search_results",
  query: "gloves",
  results: [],
};

describe("groupArtifactsForRender", () => {
  it("groups consecutive product detail artifacts into one comparison group", () => {
    const groups = groupArtifactsForRender([detail1, detail2]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      type: "product_details_group",
      products: [{ product: { internalId: 1 } }, { product: { internalId: 3 } }],
    });
  });

  it("keeps non-consecutive product detail artifacts separate", () => {
    const groups = groupArtifactsForRender([detail1, search, detail2]);

    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ type: "product_details_group" });
    expect(groups[1]).toBe(search);
    expect(groups[2]).toMatchObject({ type: "product_details_group" });
  });
});
