import type { PendingApprovalPayload } from "../chat/ui-contract";
import { getProductDetails } from "../tools/get-product-details";
import {
  createReorderRequestInput,
  createReorderRequestProposalInput,
} from "../tools/create-reorder-request";
import {
  createBasketReorderRequestInput,
  createBasketReorderRequestProposalInput,
} from "../tools/create-basket-reorder-request";
import {
  cancelReorderRequestInput,
  cancelReorderRequestProposalInput,
} from "../tools/cancel-reorder-request";
import { resolveRequestedByDate } from "../dates/resolve-requested-by-date";
import { getServiceClient } from "../db/client";
import { RequestNotFoundError } from "../errors";
import {
  prepareReorderRequestLine,
  prepareReorderRequestLines,
  summarizePreparedReorderLines,
} from "../tools/reorder-request-line";
import { createApprovalExpiry } from "./approval-execution";

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
  const normalized = await prepareReorderRequestLine({
    internalId: parsed.internalId,
    quantity: parsed.quantity,
    requestedUnit: parsed.requestedUnit,
  });
  const resolvedDate = resolveRequestedByDate(parsed.requestedByDate, timezone);

  const toolInput = createReorderRequestInput.parse({
    sessionId,
    timezone,
    internalId: normalized.internalId,
    quantity: normalized.quantity,
    requestedUnit: normalized.orderUnit,
    deliveryLocation: parsed.deliveryLocation,
    costCenter: parsed.costCenter,
    requestedByDate: resolvedDate,
    justification: parsed.justification,
  });
  const expiry = createApprovalExpiry();

  return {
    toolCallId,
    toolName: "createReorderRequest",
    toolInput,
    summary: formatCreateSummary({
      internalId: normalized.internalId,
      description: normalized.description,
      brand: normalized.brand,
      quantity: normalized.quantity,
      orderUnit: normalized.orderUnit,
      baseUnitQuantity: normalized.baseUnitQuantity,
      baseUnit: normalized.baseUnit,
      unitPrice: normalized.unitPrice,
      totalPrice: normalized.totalPrice,
      currency: normalized.currency,
      deliveryLocation: parsed.deliveryLocation,
      costCenter: parsed.costCenter,
      requestedByDate: resolvedDate,
      justification: parsed.justification,
    }),
    preview: {
      type: "create_reorder_request",
      product: {
        internalId: normalized.internalId,
        description: normalized.description,
        brand: normalized.brand,
      },
      quantity: normalized.quantity,
      orderUnit: normalized.orderUnit,
      baseUnitQuantity: normalized.baseUnitQuantity,
      baseUnit: normalized.baseUnit,
      unitPrice: normalized.unitPrice,
      totalPrice: normalized.totalPrice,
      currency: normalized.currency,
      deliveryLocation: parsed.deliveryLocation,
      costCenter: parsed.costCenter,
      requestedByDate: resolvedDate,
      justification: parsed.justification,
    },
    ...expiry,
  };
}

function formatBasketCreateSummary(args: {
  items: Awaited<ReturnType<typeof prepareReorderRequestLines>>;
  totalPrice: number | null;
  currency: string | null;
  deliveryLocation: string;
  costCenter: string;
  requestedByDate: string;
  justification?: string;
}): string {
  return [
    "Create reorder basket:",
    ...args.items.map(
      (item, index) =>
        `  ${index + 1}. ${item.description} (${item.brand}, #${item.internalId}) — ` +
        `${item.quantity} ${item.orderUnit} (= ${item.baseUnitQuantity} ${item.baseUnit})`
    ),
    ...(args.totalPrice !== null && args.currency
      ? [`  Estimated basket total: ${args.currency} ${args.totalPrice}`]
      : []),
    `  Deliver to: ${args.deliveryLocation}`,
    `  Cost center: ${args.costCenter}`,
    `  Needed by: ${args.requestedByDate}`,
    ...(args.justification ? [`  Justification: ${args.justification}`] : []),
  ].join("\n");
}

async function buildCreateBasketReorderRequestPendingToolCall(
  toolCallId: string,
  rawInput: Record<string, unknown>,
  sessionId: string,
  timezone: string
): Promise<PendingToolCall> {
  const parsed = createBasketReorderRequestProposalInput.parse(rawInput);
  const items = await prepareReorderRequestLines(parsed.items);
  const resolvedDate = resolveRequestedByDate(parsed.requestedByDate, timezone);
  const pricing = summarizePreparedReorderLines(items);

  const toolInput = createBasketReorderRequestInput.parse({
    sessionId,
    timezone,
    items: items.map((item) => ({
      internalId: item.internalId,
      quantity: item.quantity,
      requestedUnit: item.orderUnit,
    })),
    deliveryLocation: parsed.deliveryLocation,
    costCenter: parsed.costCenter,
    requestedByDate: resolvedDate,
    justification: parsed.justification,
  });
  const expiry = createApprovalExpiry();

  return {
    toolCallId,
    toolName: "createBasketReorderRequest",
    toolInput,
    summary: formatBasketCreateSummary({
      items,
      totalPrice: pricing.totalPrice,
      currency: pricing.currency,
      deliveryLocation: parsed.deliveryLocation,
      costCenter: parsed.costCenter,
      requestedByDate: resolvedDate,
      justification: parsed.justification,
    }),
    preview: {
      type: "create_basket_reorder_request",
      items: items.map((item) => ({
        product: {
          internalId: item.internalId,
          description: item.description,
          brand: item.brand,
        },
        quantity: item.quantity,
        orderUnit: item.orderUnit,
        baseUnitQuantity: item.baseUnitQuantity,
        baseUnit: item.baseUnit,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        currency: item.currency,
      })),
      totalPrice: pricing.totalPrice,
      currency: pricing.currency,
      deliveryLocation: parsed.deliveryLocation,
      costCenter: parsed.costCenter,
      requestedByDate: resolvedDate,
      justification: parsed.justification,
    },
    ...expiry,
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
    ...createApprovalExpiry(),
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

  if (args.toolName === "createBasketReorderRequest") {
    return buildCreateBasketReorderRequestPendingToolCall(
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
