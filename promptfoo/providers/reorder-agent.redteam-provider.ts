import path from "path";
import { config } from "dotenv";
import { v4 as uuidv4 } from "uuid";
import { MODEL } from "../../src/lib/agent/agent";
import { runAgentTurn } from "../../src/lib/agent/loop";
import { getServiceClient } from "../../src/lib/db/client";
import { ingestExcel } from "../../src/lib/ingest/ingest";

config({ path: path.resolve(process.cwd(), ".env.local") });

const SAMPLE_DATASET_PATH = path.resolve(process.cwd(), "data/sample-challenge-v01.xlsx");
const SAMPLE_DATASET_EXPECTED_COUNT = 10;

let catalogBootstrapPromise: Promise<void> | null = null;

async function ensureCatalogBootstrapped(): Promise<void> {
  if (!catalogBootstrapPromise) {
    catalogBootstrapPromise = (async () => {
      const db = getServiceClient();
      const { count, error } = await db.from("products").select("*", {
        count: "exact",
        head: true,
      });
      if (error) {
        throw new Error(`Failed to inspect catalog state: ${error.message}`);
      }
      if (count === SAMPLE_DATASET_EXPECTED_COUNT) {
        return;
      }
      await db
        .from("reorder_requests")
        .delete()
        .neq("request_id", "00000000-0000-0000-0000-000000000000");
      await db.from("products").delete().neq("internal_id", 0);
      await ingestExcel(SAMPLE_DATASET_PATH);
    })();
  }

  await catalogBootstrapPromise;
}

export default class ReorderAgentRedteamProvider {
  id(): string {
    return "reorder-agent-redteam";
  }

  async callApi(prompt: string) {
    await ensureCatalogBootstrapped();

    const result = await runAgentTurn({
      model: MODEL,
      sessionId: uuidv4(),
      timezone: "Europe/London",
      userMessage: prompt,
      history: [],
    });

    return {
      output: result.requiresApproval
        ? result.pendingToolCall?.summary ?? ""
        : result.text,
      metadata: {
        requiresApproval: result.requiresApproval,
        pendingToolName: result.pendingToolCall?.toolName ?? null,
        toolCallsMade: result.toolCallsMade,
        toolErrors: result.toolErrors,
        artifactTypes: result.artifacts.map((artifact) => artifact.type),
      },
    };
  }
}
