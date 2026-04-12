import { z } from "zod";
import { getProductDetails } from "./get-product-details";
import { normalizeRequestedQuantity } from "../units/convert";
import { resolveRequestedByDate } from "../dates/resolve-requested-by-date";
import { createReorderRequest } from "../db/reorder-requests";
import type { ReorderRequestRow } from "../db/reorder-requests";

export const createReorderRequestProposalInput = z.object({
  internalId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  requestedUnit: z.string().min(1),
  deliveryLocation: z.string().min(1),
  costCenter: z.string().min(1),
  requestedByDate: z.string().min(1),
  justification: z.string().optional(),
});

export const createReorderRequestInput = createReorderRequestProposalInput.extend({
  sessionId: z.string().uuid(),
  timezone: z.string().min(1).default("Europe/Zurich"),
});

/**
 * Executes the create-reorder-request tool logic.
 * Called ONLY after the user has confirmed the write proposal.
 *
 * 1. Validates product exists.
 * 2. Normalizes quantity+unit to canonical purchasing unit.
 * 3. Resolves date phrase to YYYY-MM-DD.
 * 4. Persists the request.
 */
export async function executeCreateReorderRequest(
  rawInput: z.input<typeof createReorderRequestInput>
): Promise<ReorderRequestRow> {
  const input = createReorderRequestInput.parse(rawInput);
  // 1. Validate product exists and get unit info
  const product = await getProductDetails(input.internalId);

  // 2. Normalize quantity + unit (throws on invalid unit or non-exact multiple)
  const normalized = normalizeRequestedQuantity(input.quantity, input.requestedUnit, {
    orderUnit: product.orderUnit,
    baseUnit: product.baseUnit,
    baseUnitsPerBme: product.baseUnitsPerBme,
  });

  // 3. Resolve date phrase
  const resolvedDate = resolveRequestedByDate(input.requestedByDate, input.timezone);

  // 4. Persist
  return createReorderRequest({
    sessionId: input.sessionId,
    internalId: input.internalId,
    quantity: normalized.quantity,
    orderUnit: normalized.orderUnit,
    baseUnitQuantity: normalized.baseUnitQuantity,
    deliveryLocation: input.deliveryLocation,
    costCenter: input.costCenter,
    requestedByDate: resolvedDate,
    justification: input.justification,
  });
}
