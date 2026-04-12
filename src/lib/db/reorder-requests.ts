import { getServiceClient } from "./client";
import { RequestNotFoundError, InvalidStatusTransitionError } from "../errors";

export interface CreateReorderRequestInput {
  sessionId: string;
  internalId: number;
  quantity: number;
  orderUnit: string;
  baseUnitQuantity: number;
  deliveryLocation: string;
  costCenter: string;
  requestedByDate: string;
  justification?: string;
}

export interface ReorderRequestRow {
  requestId: string;
  sessionId: string;
  internalId: number;
  quantity: number;
  orderUnit: string;
  baseUnitQuantity: number;
  deliveryLocation: string;
  costCenter: string;
  requestedByDate: string;
  justification: string | null;
  status: "pending" | "cancelled";
  createdAt: string;
}

function mapRow(row: Record<string, unknown>): ReorderRequestRow {
  return {
    requestId: row.request_id as string,
    sessionId: row.session_id as string,
    internalId: row.internal_id as number,
    quantity: row.quantity as number,
    orderUnit: row.order_unit as string,
    baseUnitQuantity: row.base_unit_quantity as number,
    deliveryLocation: row.delivery_location as string,
    costCenter: row.cost_center as string,
    requestedByDate: row.requested_by_date as string,
    justification: row.justification as string | null,
    status: row.status as "pending" | "cancelled",
    createdAt: row.created_at as string,
  };
}

export async function createReorderRequest(
  input: CreateReorderRequestInput
): Promise<ReorderRequestRow> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("reorder_requests")
    .insert({
      session_id: input.sessionId,
      internal_id: input.internalId,
      quantity: input.quantity,
      order_unit: input.orderUnit,
      base_unit_quantity: input.baseUnitQuantity,
      delivery_location: input.deliveryLocation,
      cost_center: input.costCenter,
      requested_by_date: input.requestedByDate,
      justification: input.justification ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create reorder request: ${error.message}`);
  return mapRow(data as Record<string, unknown>);
}

export async function listReorderRequests(
  sessionId: string
): Promise<ReorderRequestRow[]> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("reorder_requests")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to list reorder requests: ${error.message}`);
  return (data as Record<string, unknown>[]).map(mapRow);
}

export async function cancelReorderRequest(
  requestId: string,
  sessionId: string
): Promise<ReorderRequestRow> {
  const db = getServiceClient();

  // Fetch the row scoped to this session
  const { data: existing, error: fetchError } = await db
    .from("reorder_requests")
    .select("*")
    .eq("request_id", requestId)
    .eq("session_id", sessionId)
    .single();

  if (fetchError || !existing) {
    throw new RequestNotFoundError(requestId);
  }

  const row = existing as Record<string, unknown>;
  if (row.status !== "pending") {
    throw new InvalidStatusTransitionError(requestId, row.status as string);
  }

  const { data, error } = await db
    .from("reorder_requests")
    .update({ status: "cancelled" })
    .eq("request_id", requestId)
    .select()
    .single();

  if (error) throw new Error(`Failed to cancel reorder request: ${error.message}`);
  return mapRow(data as Record<string, unknown>);
}
