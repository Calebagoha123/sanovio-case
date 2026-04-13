import { z } from "zod";
import { resolveRequestedByDate } from "../dates/resolve-requested-by-date";
import { createReorderRequests, type ReorderRequestRow } from "../db/reorder-requests";
import { logAgentEvent } from "../agent/logging";
import {
  prepareReorderRequestLines,
  reorderRequestLineInput,
  summarizePreparedReorderLines,
} from "./reorder-request-line";

export const createBasketReorderRequestProposalInput = z.object({
  items: z.array(reorderRequestLineInput).min(2),
  deliveryLocation: z.string().min(1),
  costCenter: z.string().min(1),
  requestedByDate: z.string().min(1),
  justification: z.string().optional(),
});

export const createBasketReorderRequestInput = createBasketReorderRequestProposalInput.extend({
  sessionId: z.string().uuid(),
  timezone: z.string().min(1).default("Europe/Zurich"),
});

export interface BasketReorderRequestProfile {
  lineCount: number;
  dateResolutionMs: number;
  linePreparationMs: number;
  dbInsertMs: number;
  totalMs: number;
}

export interface BasketReorderRequestResult {
  basketId: string;
  requests: ReorderRequestRow[];
  profile: BasketReorderRequestProfile;
}

export async function executeCreateBasketReorderRequest(
  rawInput: z.input<typeof createBasketReorderRequestInput>
): Promise<BasketReorderRequestResult> {
  const startedAt = Date.now();
  const input = createBasketReorderRequestInput.parse(rawInput);

  const dateResolutionStartedAt = Date.now();
  const resolvedDate = resolveRequestedByDate(input.requestedByDate, input.timezone);
  const dateResolutionMs = Date.now() - dateResolutionStartedAt;

  const linePreparationStartedAt = Date.now();
  const lines = await prepareReorderRequestLines(input.items);
  const linePreparationMs = Date.now() - linePreparationStartedAt;

  const basketId = crypto.randomUUID();
  const dbInsertStartedAt = Date.now();
  const requests = await createReorderRequests(
    lines.map((line) => ({
      sessionId: input.sessionId,
      basketId,
      internalId: line.internalId,
      quantity: line.quantity,
      orderUnit: line.orderUnit,
      baseUnitQuantity: line.baseUnitQuantity,
      deliveryLocation: input.deliveryLocation,
      costCenter: input.costCenter,
      requestedByDate: resolvedDate,
      justification: input.justification,
    }))
  );
  const dbInsertMs = Date.now() - dbInsertStartedAt;

  const profile: BasketReorderRequestProfile = {
    lineCount: lines.length,
    dateResolutionMs,
    linePreparationMs,
    dbInsertMs,
    totalMs: Date.now() - startedAt,
  };

  const pricing = summarizePreparedReorderLines(lines);
  logAgentEvent("basket_reorder_request_profile", {
    sessionId: input.sessionId,
    basketId,
    ...profile,
    estimatedCurrency: pricing.currency,
    estimatedTotalPrice: pricing.totalPrice,
  });

  return { basketId, requests, profile };
}
