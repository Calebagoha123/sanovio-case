import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { ingestExcel } from "../ingest/ingest";
import { getServiceClient } from "../db/client";
import { DuplicateBasketProductError } from "../errors";
import { executeCreateBasketReorderRequest } from "./create-basket-reorder-request";

const EXCEL_PATH = path.resolve(process.cwd(), "data/sample-challenge-v01.xlsx");
const db = getServiceClient();

beforeAll(async () => {
  await ingestExcel(EXCEL_PATH);
});

beforeEach(async () => {
  await db.from("reorder_requests").delete().neq("request_id", "00000000-0000-0000-0000-000000000000");
});

const BASE_INPUT = {
  sessionId: uuidv4(),
  items: [
    { internalId: 1, quantity: 5, requestedUnit: "box" },
    { internalId: 2, quantity: 2, requestedUnit: "pcs" },
  ],
  deliveryLocation: "Ward 3B",
  costCenter: "CC-4412",
  requestedByDate: "2026-06-01",
};

describe("executeCreateBasketReorderRequest", () => {
  it("creates one pending row per product under a shared basket ID", async () => {
    const result = await executeCreateBasketReorderRequest(BASE_INPUT);

    expect(result.basketId).toBeTruthy();
    expect(result.requests).toHaveLength(2);
    expect(new Set(result.requests.map((request) => request.basketId))).toEqual(
      new Set([result.basketId])
    );
    expect(result.requests.map((request) => request.internalId).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(result.requests.every((request) => request.status === "pending")).toBe(true);
  });

  it("profiles the request lifecycle so benchmark runs can separate validation from DB time", async () => {
    const result = await executeCreateBasketReorderRequest(BASE_INPUT);

    expect(result.profile.lineCount).toBe(2);
    expect(result.profile.dateResolutionMs).toBeGreaterThanOrEqual(0);
    expect(result.profile.linePreparationMs).toBeGreaterThanOrEqual(0);
    expect(result.profile.dbInsertMs).toBeGreaterThanOrEqual(0);
    expect(result.profile.totalMs).toBeGreaterThanOrEqual(result.profile.linePreparationMs);
  });

  it("rejects duplicate products in the same basket", async () => {
    await expect(
      executeCreateBasketReorderRequest({
        ...BASE_INPUT,
        items: [
          { internalId: 1, quantity: 5, requestedUnit: "box" },
          { internalId: 1, quantity: 1, requestedUnit: "Piece" },
        ],
      })
    ).rejects.toThrow(DuplicateBasketProductError);
  });
});
