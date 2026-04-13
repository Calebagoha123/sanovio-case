export class ProductNotFoundError extends Error {
  constructor(internalId: number) {
    super(`Product not found: ${internalId}`);
    this.name = "ProductNotFoundError";
  }
}

export class InvalidUnitError extends Error {
  validUnits: string[];
  constructor(requestedUnit: string, validUnits: string[]) {
    super(
      `Invalid unit "${requestedUnit}". Valid units: ${validUnits.join(", ")}`
    );
    this.name = "InvalidUnitError";
    this.validUnits = validUnits;
  }
}

export class InvalidQuantityError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InvalidQuantityError";
  }
}

export class NonExactPackMultipleError extends Error {
  validOptions: Array<{ quantity: number; orderUnit: string }>;
  constructor(
    requested: number,
    baseUnit: string,
    orderUnit: string,
    baseUnitsPerBme: number
  ) {
    const lower = Math.floor(requested / baseUnitsPerBme);
    const upper = Math.ceil(requested / baseUnitsPerBme);
    const opts: Array<{ quantity: number; orderUnit: string }> = [];
    if (lower > 0) opts.push({ quantity: lower, orderUnit });
    opts.push({ quantity: upper, orderUnit });
    super(
      `${requested} ${baseUnit} is not an exact multiple of the order unit (1 ${orderUnit} = ${baseUnitsPerBme} ${baseUnit}). ` +
        `Valid purchasing options: ${opts.map((o) => `${o.quantity} ${o.orderUnit}`).join(" or ")}`
    );
    this.name = "NonExactPackMultipleError";
    this.validOptions = opts;
  }
}

export class DuplicateBasketProductError extends Error {
  constructor(internalId: number) {
    super(
      `Basket order contains duplicate product ${internalId}. Use one line per product in a basket request.`
    );
    this.name = "DuplicateBasketProductError";
  }
}

export class RequestNotFoundError extends Error {
  constructor(requestId: string) {
    super(`Reorder request not found: ${requestId}`);
    this.name = "RequestNotFoundError";
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(requestId: string, currentStatus: string) {
    super(
      `Cannot cancel request ${requestId}: current status is "${currentStatus}"`
    );
    this.name = "InvalidStatusTransitionError";
  }
}

export class ApprovalExpiredError extends Error {
  constructor(expiresAt: string) {
    super(`Pending approval expired at ${expiresAt}`);
    this.name = "ApprovalExpiredError";
  }
}
