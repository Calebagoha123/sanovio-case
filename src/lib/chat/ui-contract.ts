export interface ProductSearchResult {
  internalId: number;
  description: string;
  brand: string;
  orderUnit: string;
  netTargetPrice: number | null;
  currency: string;
}

export interface ProductDetails {
  internalId: number;
  description: string;
  brand: string;
  supplierArticleNo: string | null;
  gtinEan: string | null;
  orderUnit: string;
  baseUnit: string;
  baseUnitsPerBme: number;
  netTargetPrice: number | null;
  currency: string;
  annualQuantity: number | null;
  mdrClass: string | null;
}

export interface ReorderRequestRow {
  requestId: string;
  sessionId: string;
  basketId: string | null;
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

export interface CreatedBasketRequestArtifact {
  type: "created_basket_request";
  basketId: string;
  requests: ReorderRequestRow[];
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
  | CreatedBasketRequestArtifact
  | CancelledRequestArtifact;

export interface BasketApprovalPreviewItem {
  product: ProductReference;
  quantity: number;
  orderUnit: string;
  baseUnitQuantity: number;
  baseUnit: string;
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string | null;
}

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

export interface CreateBasketReorderApprovalPreview {
  type: "create_basket_reorder_request";
  items: BasketApprovalPreviewItem[];
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
  | CreateBasketReorderApprovalPreview
  | CancelReorderApprovalPreview;

export interface PendingApprovalPayload {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  summary: string;
  preview?: ApprovalPreview;
  createdAt: string;
  expiresAt: string;
}
