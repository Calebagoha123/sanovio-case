import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { executeCreateReorderRequest } from "./create-reorder-request";
import { ingestExcel } from "../ingest/ingest";
import { getServiceClient } from "../db/client";
import {
  ProductNotFoundError,
  InvalidUnitError,
  NonExactPackMultipleError,
} from "../errors";
import path from "path";

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
  internalId: 1,
  quantity: 5,
  requestedUnit: "box",
  deliveryLocation: "Ward 3B",
  costCenter: "CC-4412",
  requestedByDate: "2026-06-01",
};

describe("executeCreateReorderRequest", () => {
  it("returns a requestId and computes baseUnitQuantity correctly", async () => {
    const result = await executeCreateReorderRequest(BASE_INPUT);
    expect(result.requestId).toBeTruthy();
    expect(result.baseUnitQuantity).toBe(1000); // 5 box × 200 Piece
    expect(result.orderUnit).toBe("box");
    expect(result.quantity).toBe(5);
    expect(result.status).toBe("pending");
  });

  it("canonicalizes a base-unit request that is an exact multiple (1000 Piece → 5 box)", async () => {
    const result = await executeCreateReorderRequest({
      ...BASE_INPUT,
      quantity: 1000,
      requestedUnit: "Piece",
    });
    expect(result.quantity).toBe(5);
    expect(result.orderUnit).toBe("box");
    expect(result.baseUnitQuantity).toBe(1000);
  });

  it("throws NonExactPackMultipleError for a non-exact base-unit amount", async () => {
    await expect(
      executeCreateReorderRequest({
        ...BASE_INPUT,
        quantity: 900,
        requestedUnit: "Piece",
      })
    ).rejects.toThrow(NonExactPackMultipleError);
  });

  it("throws ProductNotFoundError for an unknown internalId", async () => {
    await expect(
      executeCreateReorderRequest({ ...BASE_INPUT, internalId: 9999 })
    ).rejects.toThrow(ProductNotFoundError);
  });

  it("throws InvalidUnitError for an invalid requestedUnit", async () => {
    await expect(
      executeCreateReorderRequest({ ...BASE_INPUT, requestedUnit: "palette" })
    ).rejects.toThrow(InvalidUnitError);
  });

  it("persists the row to the database", async () => {
    const result = await executeCreateReorderRequest(BASE_INPUT);
    const { data } = await db
      .from("reorder_requests")
      .select("*")
      .eq("request_id", result.requestId)
      .single();
    expect(data).toBeTruthy();
    expect(data!.quantity).toBe(5);
    expect(data!.order_unit).toBe("box");
  });

  it("rejects a past requestedByDate", async () => {
    await expect(
      executeCreateReorderRequest({
        ...BASE_INPUT,
        requestedByDate: "2020-01-01",
      })
    ).rejects.toThrow(/past/i);
  });
});
