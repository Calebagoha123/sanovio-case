import { z } from "zod";
import { resolveRequestedByDate } from "../dates/resolve-requested-by-date";
import { createReorderRequest } from "../db/reorder-requests";
import type { ReorderRequestRow } from "../db/reorder-requests";
import { prepareReorderRequestLine } from "./reorder-request-line";

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
  const normalized = await prepareReorderRequestLine({
    internalId: input.internalId,
    quantity: input.quantity,
    requestedUnit: input.requestedUnit,
  });

  const resolvedDate = resolveRequestedByDate(input.requestedByDate, input.timezone);

  return createReorderRequest({
    sessionId: input.sessionId,
    internalId: normalized.internalId,
    quantity: normalized.quantity,
    orderUnit: normalized.orderUnit,
    baseUnitQuantity: normalized.baseUnitQuantity,
    deliveryLocation: input.deliveryLocation,
    costCenter: input.costCenter,
    requestedByDate: resolvedDate,
    justification: input.justification,
  });
}
