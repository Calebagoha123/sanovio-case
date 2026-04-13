import type { CatalogScalingDatasetKey } from "./catalog-scaling";

export const CATALOG_SCALING_THRESHOLDS: Record<
  CatalogScalingDatasetKey,
  Record<string, number>
> = {
  sample: {
    ingest_excel: 1_500,
    search_natural_language: 100,
    search_exact_identifier: 25,
    get_product_details: 50,
    create_basket_reorder_request: 150,
    list_reorder_requests: 100,
  },
  "100": {
    ingest_excel: 1_500,
    search_natural_language: 100,
    search_exact_identifier: 25,
    get_product_details: 50,
    create_basket_reorder_request: 150,
    list_reorder_requests: 100,
  },
  "1000": {
    ingest_excel: 2_500,
    search_natural_language: 125,
    search_exact_identifier: 25,
    get_product_details: 50,
    create_basket_reorder_request: 150,
    list_reorder_requests: 100,
  },
  "100000": {
    ingest_excel: 12_000,
    search_natural_language: 150,
    search_exact_identifier: 50,
    get_product_details: 50,
    create_basket_reorder_request: 150,
    list_reorder_requests: 100,
  },
};
