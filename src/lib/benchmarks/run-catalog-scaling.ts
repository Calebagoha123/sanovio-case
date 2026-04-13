import { getServiceClient } from "../db/client";
import { ingestExcel } from "../ingest/ingest";
import { searchCatalog } from "../tools/search-catalog";
import { getProductDetails } from "../tools/get-product-details";
import { executeCreateBasketReorderRequest } from "../tools/create-basket-reorder-request";
import { executeListReorderRequests } from "../tools/list-reorder-requests";
import {
  getCatalogScalingDataset,
  getCatalogScalingScenarios,
  type CatalogScalingDataset,
  type CatalogScalingDatasetKey,
} from "./catalog-scaling";

export interface BenchResult {
  step: string;
  durationMs: number;
  notes?: Record<string, unknown>;
}

export interface CatalogScalingRun {
  dataset: CatalogScalingDataset;
  metrics: BenchResult[];
}

async function measure<T>(
  step: string,
  fn: () => Promise<T>
): Promise<{ result: T; metric: BenchResult }> {
  const startedAt = performance.now();
  const result = await fn();
  return {
    result,
    metric: {
      step,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    },
  };
}

export async function runCatalogScalingBenchmark(
  selection: string
): Promise<CatalogScalingRun> {
  const dataset = getCatalogScalingDataset(selection);
  const restoreDataset = getCatalogScalingDataset("sample");
  const scenarios = getCatalogScalingScenarios();
  const sessionId = crypto.randomUUID();
  const db = getServiceClient();

  try {
    await db.from("reorder_requests").delete().neq("request_id", "00000000-0000-0000-0000-000000000000");
    await db.from("products").delete().neq("internal_id", 0);

    const metrics: BenchResult[] = [];

    const ingestMeasured = await measure("ingest_excel", async () => {
      await ingestExcel(dataset.filePath);
      const { count, error } = await db
        .from("products")
        .select("*", { count: "exact", head: true });
      if (error) {
        throw new Error(`Failed to count products after ingest: ${error.message}`);
      }
      return count ?? 0;
    });
    metrics.push({
      ...ingestMeasured.metric,
      notes: {
        expectedRowCount: dataset.expectedRowCount,
        actualRowCount: ingestMeasured.result,
        matchedExpected: ingestMeasured.result === dataset.expectedRowCount,
      },
    });

    const naturalSearchMeasured = await measure("search_natural_language", async () =>
      searchCatalog(scenarios.searchNaturalLanguage)
    );
    metrics.push({
      ...naturalSearchMeasured.metric,
      notes: {
        resultCount: naturalSearchMeasured.result.length,
        firstInternalId: naturalSearchMeasured.result[0]?.internalId ?? null,
      },
    });

    const exactSearchMeasured = await measure("search_exact_identifier", async () =>
      searchCatalog(scenarios.searchExactIdentifier)
    );
    metrics.push({
      ...exactSearchMeasured.metric,
      notes: {
        resultCount: exactSearchMeasured.result.length,
        firstInternalId: exactSearchMeasured.result[0]?.internalId ?? null,
      },
    });

    const detailsMeasured = await measure("get_product_details", async () =>
      getProductDetails(scenarios.productDetailsInternalId)
    );
    metrics.push({
      ...detailsMeasured.metric,
      notes: {
        internalId: detailsMeasured.result.internalId,
        orderUnit: detailsMeasured.result.orderUnit,
      },
    });

    const basketMeasured = await measure("create_basket_reorder_request", async () =>
      executeCreateBasketReorderRequest({
        sessionId,
        timezone: "Europe/London",
        ...scenarios.basketRequest,
      })
    );
    metrics.push({
      ...basketMeasured.metric,
      notes: {
        basketId: basketMeasured.result.basketId,
        requestCount: basketMeasured.result.requests.length,
        profile: basketMeasured.result.profile,
      },
    });

    const listMeasured = await measure("list_reorder_requests", async () =>
      executeListReorderRequests(sessionId)
    );
    metrics.push({
      ...listMeasured.metric,
      notes: {
        resultCount: listMeasured.result.length,
      },
    });

    return { dataset, metrics };
  } finally {
    await db.from("reorder_requests").delete().neq("request_id", "00000000-0000-0000-0000-000000000000");
    await db.from("products").delete().neq("internal_id", 0);
    await ingestExcel(restoreDataset.filePath);
  }
}

export function getMetric(run: CatalogScalingRun, step: string): BenchResult {
  const metric = run.metrics.find((candidate) => candidate.step === step);
  if (!metric) {
    throw new Error(`Missing benchmark metric for step "${step}".`);
  }
  return metric;
}

export type CatalogScalingStep = BenchResult["step"];
export type CatalogScalingThresholdMap = Record<CatalogScalingStep, number>;

export function createThresholdSummary(run: CatalogScalingRun): Record<string, number> {
  return Object.fromEntries(run.metrics.map((metric) => [metric.step, metric.durationMs]));
}

export type CatalogScalingThresholdSelection = CatalogScalingDatasetKey;
