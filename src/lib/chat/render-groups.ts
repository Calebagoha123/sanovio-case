import type { AgentUiArtifact, ProductDetailsArtifact } from "./ui-contract";

export interface ProductDetailsGroup {
  type: "product_details_group";
  products: ProductDetailsArtifact[];
}

export type RenderArtifactGroup = AgentUiArtifact | ProductDetailsGroup;

export function groupArtifactsForRender(
  artifacts: AgentUiArtifact[]
): RenderArtifactGroup[] {
  const groups: RenderArtifactGroup[] = [];

  for (const artifact of artifacts) {
    if (artifact.type === "product_details") {
      const last = groups[groups.length - 1];
      if (last && last.type === "product_details_group") {
        last.products.push(artifact);
      } else {
        groups.push({
          type: "product_details_group",
          products: [artifact],
        });
      }
      continue;
    }

    groups.push(artifact);
  }

  return groups;
}
