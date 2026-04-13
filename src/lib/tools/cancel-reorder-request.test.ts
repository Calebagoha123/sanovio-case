import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { executeCancelReorderRequest } from "./cancel-reorder-request";
import { createReorderRequest } from "../db/reorder-requests";
import { getServiceClient } from "../db/client";
import { RequestNotFoundError, InvalidStatusTransitionError } from "../errors";

const db = getServiceClient();

beforeAll(async () => {
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

const BASE = {
  internalId: 1,
  quantity: 5,
  orderUnit: "box",
  baseUnitQuantity: 1000,
  deliveryLocation: "Ward 3B",
  costCenter: "CC-4412",
  requestedByDate: "2026-06-01",
};

describe("executeCancelReorderRequest", () => {
  it("transitions a pending request to cancelled", async () => {
    const sessionId = uuidv4();
    const { requestId } = await createReorderRequest({ ...BASE, sessionId });

    const result = await executeCancelReorderRequest(requestId, sessionId);
    expect(result.status).toBe("cancelled");
  });

  it("throws RequestNotFoundError for unknown requestId", async () => {
    await expect(
      executeCancelReorderRequest(uuidv4(), uuidv4())
    ).rejects.toThrow(RequestNotFoundError);
  });

  it("throws InvalidStatusTransitionError when already cancelled", async () => {
    const sessionId = uuidv4();
    const { requestId } = await createReorderRequest({ ...BASE, sessionId });
    await executeCancelReorderRequest(requestId, sessionId);

    await expect(
      executeCancelReorderRequest(requestId, sessionId)
    ).rejects.toThrow(InvalidStatusTransitionError);
  });

  it("throws RequestNotFoundError when cancelling a request from a different session", async () => {
    const ownerSessionId = uuidv4();
    const attackerSessionId = uuidv4();
    const { requestId } = await createReorderRequest({ ...BASE, sessionId: ownerSessionId });

    await expect(
      executeCancelReorderRequest(requestId, attackerSessionId)
    ).rejects.toThrow(RequestNotFoundError);
  });
});
