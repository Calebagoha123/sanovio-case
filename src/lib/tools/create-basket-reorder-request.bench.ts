import { bench, beforeAll, beforeEach, describe } from "vitest";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { ingestExcel } from "../ingest/ingest";
import { getServiceClient } from "../db/client";
import { executeCreateBasketReorderRequest } from "./create-basket-reorder-request";

const EXCEL_PATH = path.resolve(process.cwd(), "data/sample-challenge-v01.xlsx");
const db = getServiceClient();

beforeAll(async () => {
  await ingestExcel(EXCEL_PATH);
});

beforeEach(async () => {
  await db.from("reorder_requests").delete().neq("request_id", "00000000-0000-0000-0000-000000000000");
});

function buildInput(items: Array<{ internalId: number; quantity: number; requestedUnit: string }>) {
  return {
    sessionId: uuidv4(),
    items,
    deliveryLocation: "Ward 3B",
    costCenter: "CC-4412",
    requestedByDate: "2026-06-01",
  };
}

describe("createBasketReorderRequest", () => {
  bench(
    "2-line basket",
    async () => {
      await executeCreateBasketReorderRequest(
        buildInput([
          { internalId: 1, quantity: 5, requestedUnit: "box" },
          { internalId: 2, quantity: 2, requestedUnit: "pcs" },
        ])
      );
    },
    { iterations: 5, warmupIterations: 1 }
  );

  bench(
    "5-line basket",
    async () => {
      await executeCreateBasketReorderRequest(
        buildInput([
          { internalId: 1, quantity: 5, requestedUnit: "box" },
          { internalId: 2, quantity: 2, requestedUnit: "pcs" },
          { internalId: 3, quantity: 1, requestedUnit: "pack" },
          { internalId: 7, quantity: 1, requestedUnit: "can" },
          { internalId: 10, quantity: 1, requestedUnit: "role" },
        ])
      );
    },
    { iterations: 5, warmupIterations: 1 }
  );
});
