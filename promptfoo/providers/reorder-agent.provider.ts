import path from "path";
import { config } from "dotenv";
import { v4 as uuidv4 } from "uuid";
import type { ModelMessage } from "ai";
import { MODEL } from "../../src/lib/agent/agent";
import { runAgentTurn } from "../../src/lib/agent/loop";
import { getServiceClient } from "../../src/lib/db/client";
import { ingestExcel } from "../../src/lib/ingest/ingest";

config({ path: path.resolve(process.cwd(), ".env.local") });

const SAMPLE_DATASET_PATH = path.resolve(process.cwd(), "data/sample-challenge-v01.xlsx");
const SYNTHETIC_100_DATASET_PATH = path.resolve(process.cwd(), "data/synthetic-catalog-100.xlsx");
const DATASET_EXPECTED_COUNTS: Record<string, number> = {
  sample: 10,
  synthetic100: 100,
};

const DATASET_PATHS: Record<string, string> = {
  sample: SAMPLE_DATASET_PATH,
  synthetic100: SYNTHETIC_100_DATASET_PATH,
};

let catalogBootstrapPromise: Promise<void> | null = null;
let bootstrappedDatasetKey: string | null = null;

function normalizeHistory(value: unknown): ModelMessage[] {
  if (Array.isArray(value)) {
    return value as ModelMessage[];
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as ModelMessage[];
    }
  }

  return [];
}

async function ensureCatalogBootstrapped(datasetKey = "sample"): Promise<void> {
  const datasetPath = DATASET_PATHS[datasetKey];
  if (!datasetPath) {
    throw new Error(`Unsupported promptfoo dataset "${datasetKey}"`);
  }

  if (!catalogBootstrapPromise || bootstrappedDatasetKey !== datasetKey) {
    catalogBootstrapPromise = (async () => {
      const db = getServiceClient();
      const { count, error } = await db.from("products").select("*", {
        count: "exact",
        head: true,
      });
      if (error) {
        throw new Error(`Failed to inspect catalog state: ${error.message}`);
      }
      if (count === DATASET_EXPECTED_COUNTS[datasetKey]) {
        bootstrappedDatasetKey = datasetKey;
        return;
      }
      await db
        .from("reorder_requests")
        .delete()
        .neq("request_id", "00000000-0000-0000-0000-000000000000");
      await db.from("products").delete().neq("internal_id", 0);
      await ingestExcel(datasetPath);
      bootstrappedDatasetKey = datasetKey;
    })();
  }

  await catalogBootstrapPromise;
}

export default class ReorderAgentPromptfooProvider {
  id(): string {
    return "reorder-agent";
  }

  async callApi(prompt: string, context?: { vars?: Record<string, unknown> }) {
    const vars = context?.vars ?? {};
    await ensureCatalogBootstrapped(
      typeof vars.catalogDataset === "string" ? vars.catalogDataset : "sample"
    );
    const startedAt = Date.now();
    const result = await runAgentTurn({
      model: MODEL,
      sessionId: typeof vars.sessionId === "string" ? vars.sessionId : uuidv4(),
      timezone: typeof vars.timezone === "string" ? vars.timezone : "Europe/London",
      userMessage: String(vars.input ?? ""),
      history: normalizeHistory(vars.history),
      systemPromptOverride: prompt,
    });

    const artifactTypes = result.artifacts.map((artifact) => artifact.type);
    const outputText = result.requiresApproval
      ? result.pendingToolCall?.summary ?? ""
      : result.text;

    return {
      output: outputText,
      metadata: {
        durationMs: Date.now() - startedAt,
        requiresApproval: result.requiresApproval,
        pendingToolName: result.pendingToolCall?.toolName ?? null,
        pendingPreviewType: result.pendingToolCall?.preview?.type ?? null,
        pendingSummary: result.pendingToolCall?.summary ?? null,
        pendingCreatedAt: result.pendingToolCall?.createdAt ?? null,
        pendingExpiresAt: result.pendingToolCall?.expiresAt ?? null,
        toolCallsMade: result.toolCallsMade,
        toolErrors: result.toolErrors,
        artifactTypes,
        rawText: result.text,
      },
    };
  }
}
