import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  createReorderRequest,
  createReorderRequests,
  listReorderRequests,
  cancelReorderRequest,
  type CreateReorderRequestInput,
} from "./reorder-requests";
import { getServiceClient } from "./client";
import {
  RequestNotFoundError,
  InvalidStatusTransitionError,
} from "../errors";

const db = getServiceClient();

// A valid product that must exist in the DB before these tests.
// Run the ingest first, or insert a fixture product inline.
const PRODUCT_INTERNAL_ID = 1;

const BASE_INPUT: CreateReorderRequestInput = {
  sessionId: uuidv4(),
  internalId: PRODUCT_INTERNAL_ID,
  quantity: 5,
  orderUnit: "box",
  baseUnitQuantity: 1000,
  deliveryLocation: "Ward 3B",
  costCenter: "CC-4412",
  requestedByDate: "2026-06-01",
};

beforeAll(async () => {
  // Ensure product 1 exists (ingest may not have run yet in this test run)
  await db.from("products").upsert({
    internal_id: 1,
    description: "Nitrilhandschuh Sensicare Ice blau L",
    brand: "Medline",
    supplier_article_no: "486803",
    order_unit: "box",
    base_unit: "Piece",
    base_units_per_bme: 200,
    net_target_price: 0.019,
    currency: "CHF",
    annual_quantity: 4000,
    gtin_ean: "04046719012345",
    mdr_class: "I",
  }, { onConflict: "internal_id" });
});

beforeEach(async () => {
  await db.from("reorder_requests").delete().neq("request_id", "00000000-0000-0000-0000-000000000000");
});

describe("createReorderRequest", () => {
  it("inserts a row with status 'pending' and a generated UUID", async () => {
    const result = await createReorderRequest(BASE_INPUT);
    expect(result.requestId).toBeTruthy();
    expect(result.status).toBe("pending");

    const { data } = await db
      .from("reorder_requests")
      .select("*")
      .eq("request_id", result.requestId)
      .single();
    expect(data).toBeTruthy();
    expect(data!.status).toBe("pending");
  });

  it("persists session_id on the row", async () => {
    const sessionId = uuidv4();
    const result = await createReorderRequest({ ...BASE_INPUT, sessionId });
    const { data } = await db
      .from("reorder_requests")
      .select("session_id")
      .eq("request_id", result.requestId)
      .single();
    expect(data!.session_id).toBe(sessionId);
  });

  it("persists all mandatory fields correctly", async () => {
    const result = await createReorderRequest(BASE_INPUT);
    const { data } = await db
      .from("reorder_requests")
      .select("*")
      .eq("request_id", result.requestId)
      .single();
    expect(data!.internal_id).toBe(BASE_INPUT.internalId);
    expect(data!.quantity).toBe(BASE_INPUT.quantity);
    expect(data!.order_unit).toBe(BASE_INPUT.orderUnit);
    expect(data!.base_unit_quantity).toBe(BASE_INPUT.baseUnitQuantity);
    expect(data!.delivery_location).toBe(BASE_INPUT.deliveryLocation);
    expect(data!.cost_center).toBe(BASE_INPUT.costCenter);
    expect(data!.requested_by_date).toBe(BASE_INPUT.requestedByDate);
  });
});

describe("createReorderRequests", () => {
  it("inserts multiple rows with a shared basket_id", async () => {
    const sessionId = uuidv4();
    const basketId = uuidv4();

    const result = await createReorderRequests([
      { ...BASE_INPUT, sessionId, basketId, internalId: 1, quantity: 5, baseUnitQuantity: 1000 },
      {
        ...BASE_INPUT,
        sessionId,
        basketId,
        internalId: 2,
        quantity: 2,
        orderUnit: "pcs",
        baseUnitQuantity: 2,
      },
    ]);

    expect(result).toHaveLength(2);
    expect(new Set(result.map((row) => row.basketId))).toEqual(new Set([basketId]));

    const { data } = await db
      .from("reorder_requests")
      .select("basket_id")
      .eq("session_id", sessionId)
      .eq("basket_id", basketId);

    expect(data).toHaveLength(2);
  });
});

describe("listReorderRequests", () => {
  it("returns an empty array when no requests exist for the session", async () => {
    const result = await listReorderRequests(uuidv4());
    expect(result).toEqual([]);
  });

  it("returns requests in creation order (by created_at)", async () => {
    const sessionId = uuidv4();
    await createReorderRequest({ ...BASE_INPUT, sessionId, quantity: 2 });
    await createReorderRequest({ ...BASE_INPUT, sessionId, quantity: 3 });

    const result = await listReorderRequests(sessionId);
    expect(result).toHaveLength(2);
    expect(result[0].quantity).toBe(2);
    expect(result[1].quantity).toBe(3);
  });

  it("does not return rows from a different session", async () => {
    const sessionA = uuidv4();
    const sessionB = uuidv4();
    await createReorderRequest({ ...BASE_INPUT, sessionId: sessionA });
    await createReorderRequest({ ...BASE_INPUT, sessionId: sessionB });

    const resultA = await listReorderRequests(sessionA);
    const resultB = await listReorderRequests(sessionB);
    expect(resultA).toHaveLength(1);
    expect(resultB).toHaveLength(1);
    expect(resultA[0].sessionId).toBe(sessionA);
    expect(resultB[0].sessionId).toBe(sessionB);
  });
});

describe("cancelReorderRequest", () => {
  it("transitions a pending request to cancelled", async () => {
    const sessionId = uuidv4();
    const { requestId } = await createReorderRequest({ ...BASE_INPUT, sessionId });

    await cancelReorderRequest(requestId, sessionId);

    const { data } = await db
      .from("reorder_requests")
      .select("status")
      .eq("request_id", requestId)
      .single();
    expect(data!.status).toBe("cancelled");
  });

  it("throws RequestNotFoundError for a non-existent request_id", async () => {
    const fakeId = uuidv4();
    await expect(cancelReorderRequest(fakeId, uuidv4())).rejects.toThrow(
      RequestNotFoundError
    );
  });

  it("throws RequestNotFoundError when request_id belongs to a different session", async () => {
    const sessionA = uuidv4();
    const sessionB = uuidv4();
    const { requestId } = await createReorderRequest({ ...BASE_INPUT, sessionId: sessionA });

    await expect(cancelReorderRequest(requestId, sessionB)).rejects.toThrow(
      RequestNotFoundError
    );
  });

  it("throws InvalidStatusTransitionError when cancelling an already-cancelled request", async () => {
    const sessionId = uuidv4();
    const { requestId } = await createReorderRequest({ ...BASE_INPUT, sessionId });
    await cancelReorderRequest(requestId, sessionId);

    await expect(cancelReorderRequest(requestId, sessionId)).rejects.toThrow(
      InvalidStatusTransitionError
    );
  });
});
