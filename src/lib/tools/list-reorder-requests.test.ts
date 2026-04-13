import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { executeListReorderRequests } from "./list-reorder-requests";
import { createReorderRequest } from "../db/reorder-requests";
import { getServiceClient } from "../db/client";

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

afterEach(() => {
  vi.restoreAllMocks();
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

describe("executeListReorderRequests", () => {
  it("returns [] when no requests exist for the session", async () => {
    const result = await executeListReorderRequests(uuidv4());
    expect(result).toEqual([]);
  });

  it("returns requests in creation order after two creates", async () => {
    const sessionId = uuidv4();
    await createReorderRequest({ ...BASE, sessionId, quantity: 2 });
    await createReorderRequest({ ...BASE, sessionId, quantity: 3 });

    const result = await executeListReorderRequests(sessionId);
    expect(result).toHaveLength(2);
    expect(result[0].quantity).toBe(2);
    expect(result[1].quantity).toBe(3);
  });

  it("does not return requests from other sessions", async () => {
    const s1 = uuidv4();
    const s2 = uuidv4();
    await createReorderRequest({ ...BASE, sessionId: s1 });

    const result = await executeListReorderRequests(s2);
    expect(result).toHaveLength(0);
  });

  it("logs timing and result count for the session lookup", async () => {
    const sessionId = uuidv4();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await createReorderRequest({ ...BASE, sessionId });
    await executeListReorderRequests(sessionId);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"list_reorder_requests_complete"')
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining(`"sessionId":"${sessionId}"`)
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('"resultCount":1')
    );
  });
});
