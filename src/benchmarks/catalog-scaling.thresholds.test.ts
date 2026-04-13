import { describe, expect, it } from "vitest";
import { config } from "dotenv";
import path from "path";
import { CATALOG_SCALING_THRESHOLDS } from "../lib/benchmarks/catalog-scaling-thresholds";
import {
  createThresholdSummary,
  runCatalogScalingBenchmark,
} from "../lib/benchmarks/run-catalog-scaling";
import { getCatalogScalingDataset } from "../lib/benchmarks/catalog-scaling";

config({ path: path.resolve(process.cwd(), ".env.local") });

describe("catalog scaling thresholds", () => {
  it(
    "stays within the configured latency ceilings for the selected dataset",
    async () => {
      const selection = process.env.BENCH_DATASET ?? "sample";
      const dataset = getCatalogScalingDataset(selection);
      const run = await runCatalogScalingBenchmark(dataset.key);
      const thresholds = CATALOG_SCALING_THRESHOLDS[dataset.key];

      console.log(
        JSON.stringify(
          {
            dataset: run.dataset,
            thresholds,
            actuals: createThresholdSummary(run),
          },
          null,
          2
        )
      );

      for (const metric of run.metrics) {
        const threshold = thresholds[metric.step];
        if (threshold === undefined) {
          throw new Error(`No threshold configured for step "${metric.step}" in dataset "${dataset.key}".`);
        }
        expect(
          metric.durationMs,
          `${metric.step} exceeded threshold ${threshold}ms with ${metric.durationMs}ms`
        ).toBeLessThanOrEqual(threshold);
      }
    },
    180_000
  );
});
