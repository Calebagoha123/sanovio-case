import { describe, expect, it } from "vitest";
import { config } from "dotenv";
import path from "path";
import { runCatalogScalingBenchmark, getMetric } from "../lib/benchmarks/run-catalog-scaling";

config({ path: path.resolve(process.cwd(), ".env.local") });

describe("catalog scaling report", () => {
  it(
    "measures ingest, search, details, basket create, and list timings for the selected dataset",
    async () => {
      const selection = process.env.BENCH_DATASET ?? "sample";
      const run = await runCatalogScalingBenchmark(selection);

      console.log(`Running scaling benchmark for ${run.dataset.label}`);
      console.log(`Workbook: ${run.dataset.filePath}`);
      console.log(JSON.stringify(run, null, 2));

      expect(getMetric(run, "ingest_excel").notes?.matchedExpected).toBe(true);
      expect(getMetric(run, "search_natural_language").notes?.resultCount).toBeGreaterThan(0);
      expect(getMetric(run, "search_exact_identifier").notes?.firstInternalId).toBe(1);
      expect(getMetric(run, "get_product_details").notes?.internalId).toBe(1);
      expect(getMetric(run, "create_basket_reorder_request").notes?.requestCount).toBe(2);
      expect(getMetric(run, "list_reorder_requests").notes?.resultCount).toBe(2);
    },
    180_000
  );
});
