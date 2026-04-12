import type { ReorderRequestRow } from "../db/reorder-requests";
import type { ProductDetails } from "../tools/get-product-details";
import type { ProductSearchResult } from "../tools/search-catalog";

export interface ProductReference {
  internalId: number;
  description: string;
  brand: string;
}

export interface SearchResultsArtifact {
  type: "search_results";
  query: string;
  results: ProductSearchResult[];
}

export interface ProductDetailsArtifact {
  type: "product_details";
  product: ProductDetails;
}

export interface ReorderRequestsArtifact {
  type: "reorder_requests";
  requests: ReorderRequestRow[];
}

export interface CreatedRequestArtifact {
  type: "created_request";
  request: ReorderRequestRow;
}

export interface CancelledRequestArtifact {
  type: "cancelled_request";
  request: ReorderRequestRow;
}

export type AgentUiArtifact =
  | SearchResultsArtifact
  | ProductDetailsArtifact
  | ReorderRequestsArtifact
  | CreatedRequestArtifact
  | CancelledRequestArtifact;

export interface CreateReorderApprovalPreview {
  type: "create_reorder_request";
  product: ProductReference;
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
}

export interface CancelReorderApprovalPreview {
  type: "cancel_reorder_request";
  requestId: string;
  product: ProductReference;
  quantity: number;
  orderUnit: string;
  deliveryLocation: string;
  costCenter: string;
  requestedByDate: string;
  status: "pending" | "cancelled";
}

export type ApprovalPreview =
  | CreateReorderApprovalPreview
  | CancelReorderApprovalPreview;

export interface PendingApprovalPayload {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  summary: string;
  preview?: ApprovalPreview;
}
