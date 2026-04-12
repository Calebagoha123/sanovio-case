import type { PendingApprovalPayload } from "../chat/ui-contract";
import { getProductDetails } from "../tools/get-product-details";
import {
  createReorderRequestInput,
  createReorderRequestProposalInput,
} from "../tools/create-reorder-request";
import {
  cancelReorderRequestInput,
  cancelReorderRequestProposalInput,
} from "../tools/cancel-reorder-request";
import { normalizeRequestedQuantity } from "../units/convert";
import { resolveRequestedByDate } from "../dates/resolve-requested-by-date";
import { getServiceClient } from "../db/client";
import { RequestNotFoundError } from "../errors";

export interface PendingToolCall extends PendingApprovalPayload {}

function formatCreateSummary(args: {
  internalId: number;
  description: string;
  brand: string;
  quantity: number;
  orderUnit: string;
  baseUnitQuantity: number;
  baseUnit: string;
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string | null;
  deliveryLocation: string;
  costCenter: string;
  requestedByDate: string;
  justification?: string;
}): string {
  return [
    "Create reorder request:",
    `  Product: ${args.description} (${args.brand}, #${args.internalId})`,
    `  Quantity: ${args.quantity} ${args.orderUnit} (= ${args.baseUnitQuantity} ${args.baseUnit})`,
    ...(args.unitPrice !== null && args.totalPrice !== null && args.currency
      ? [
          `  Unit price: ${args.currency} ${args.unitPrice}`,
          `  Estimated total: ${args.currency} ${args.totalPrice}`,
        ]
      : []),
    `  Deliver to: ${args.deliveryLocation}`,
    `  Cost center: ${args.costCenter}`,
    `  Needed by: ${args.requestedByDate}`,
    ...(args.justification ? [`  Justification: ${args.justification}`] : []),
  ].join("\n");
}

async function buildCreateReorderRequestPendingToolCall(
  toolCallId: string,
  rawInput: Record<string, unknown>,
  sessionId: string,
  timezone: string
): Promise<PendingToolCall> {
  const parsed = createReorderRequestProposalInput.parse(rawInput);
  const product = await getProductDetails(parsed.internalId);
  const normalized = normalizeRequestedQuantity(parsed.quantity, parsed.requestedUnit, {
    orderUnit: product.orderUnit,
    baseUnit: product.baseUnit,
    baseUnitsPerBme: product.baseUnitsPerBme,
  });
  const resolvedDate = resolveRequestedByDate(parsed.requestedByDate, timezone);
  const totalPrice =
    product.netTargetPrice === null ? null : Number((product.netTargetPrice * normalized.quantity).toFixed(2));

  const toolInput = createReorderRequestInput.parse({
    sessionId,
    timezone,
    internalId: parsed.internalId,
    quantity: normalized.quantity,
    requestedUnit: normalized.orderUnit,
    deliveryLocation: parsed.deliveryLocation,
    costCenter: parsed.costCenter,
    requestedByDate: resolvedDate,
    justification: parsed.justification,
  });

  return {
    toolCallId,
    toolName: "createReorderRequest",
    toolInput,
    summary: formatCreateSummary({
      internalId: parsed.internalId,
      description: product.description,
      brand: product.brand,
      quantity: normalized.quantity,
      orderUnit: normalized.orderUnit,
      baseUnitQuantity: normalized.baseUnitQuantity,
      baseUnit: product.baseUnit,
      unitPrice: product.netTargetPrice,
      totalPrice,
      currency: product.currency ?? null,
      deliveryLocation: parsed.deliveryLocation,
      costCenter: parsed.costCenter,
      requestedByDate: resolvedDate,
      justification: parsed.justification,
    }),
    preview: {
      type: "create_reorder_request",
      product: {
        internalId: product.internalId,
        description: product.description,
        brand: product.brand,
      },
      quantity: normalized.quantity,
      orderUnit: normalized.orderUnit,
      baseUnitQuantity: normalized.baseUnitQuantity,
      baseUnit: product.baseUnit,
      unitPrice: product.netTargetPrice,
      totalPrice,
      currency: product.currency ?? null,
      deliveryLocation: parsed.deliveryLocation,
      costCenter: parsed.costCenter,
      requestedByDate: resolvedDate,
      justification: parsed.justification,
    },
  };
}

async function buildCancelReorderRequestPendingToolCall(
  toolCallId: string,
  rawInput: Record<string, unknown>,
  sessionId: string
): Promise<PendingToolCall> {
  const parsed = cancelReorderRequestProposalInput.parse(rawInput);
  const toolInput = cancelReorderRequestInput.parse({
    requestId: parsed.requestId,
    sessionId,
  });

  const db = getServiceClient();
  const { data, error } = await db
    .from("reorder_requests")
    .select("request_id, internal_id, quantity, order_unit, delivery_location, cost_center, requested_by_date, status")
    .eq("request_id", parsed.requestId)
    .eq("session_id", sessionId)
    .single();

  if (error || !data) {
    throw new RequestNotFoundError(parsed.requestId);
  }

  const product = await getProductDetails(data.internal_id as number);
  const summary = [
    "Cancel reorder request:",
    `  Request ID: ${data.request_id as string}`,
    `  Product: ${product.description} (${product.brand}, #${product.internalId})`,
    `  Quantity: ${data.quantity as number} ${data.order_unit as string}`,
    `  Deliver to: ${data.delivery_location as string}`,
    `  Cost center: ${data.cost_center as string}`,
    `  Needed by: ${data.requested_by_date as string}`,
    `  Status: ${data.status as string}`,
  ].join("\n");

  return {
    toolCallId,
    toolName: "cancelReorderRequest",
    toolInput,
    summary,
    preview: {
      type: "cancel_reorder_request",
      requestId: data.request_id as string,
      product: {
        internalId: product.internalId,
        description: product.description,
        brand: product.brand,
      },
      quantity: data.quantity as number,
      orderUnit: data.order_unit as string,
      deliveryLocation: data.delivery_location as string,
      costCenter: data.cost_center as string,
      requestedByDate: data.requested_by_date as string,
      status: data.status as "pending" | "cancelled",
    },
  };
}

export async function buildPendingToolCall(args: {
  toolCallId: string;
  toolName: string;
  rawInput: Record<string, unknown>;
  sessionId: string;
  timezone: string;
}): Promise<PendingToolCall> {
  if (args.toolName === "createReorderRequest") {
    return buildCreateReorderRequestPendingToolCall(
      args.toolCallId,
      args.rawInput,
      args.sessionId,
      args.timezone
    );
  }

  if (args.toolName === "cancelReorderRequest") {
    return buildCancelReorderRequestPendingToolCall(
      args.toolCallId,
      args.rawInput,
      args.sessionId
    );
  }

  throw new Error(`Unsupported approval tool: ${args.toolName}`);
}
