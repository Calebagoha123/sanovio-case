import {
  InvalidUnitError,
  InvalidQuantityError,
  NonExactPackMultipleError,
} from "../errors";

export interface ProductUnitInfo {
  orderUnit: string;
  baseUnit: string;
  baseUnitsPerBme: number;
}

export interface BaseUnitResult {
  quantity: number;
  unit: string;
}

export interface NormalizedQuantity {
  quantity: number;
  orderUnit: string;
  baseUnitQuantity: number;
}

/**
 * Convert a requested quantity + unit into the base unit quantity.
 * Accepts either the product's order unit or its base unit as input.
 * Throws if the unit is not valid for this product.
 */
export function convertToBaseUnit(
  quantity: number,
  unit: string,
  product: ProductUnitInfo
): BaseUnitResult {
  if (quantity <= 0) {
    throw new InvalidQuantityError(
      `Quantity must be a positive number, got ${quantity}`
    );
  }

  const { orderUnit, baseUnit, baseUnitsPerBme } = product;
  const unitLower = unit.toLowerCase();

  if (unitLower === orderUnit.toLowerCase()) {
    return { quantity: quantity * baseUnitsPerBme, unit: baseUnit };
  }

  if (unitLower === baseUnit.toLowerCase()) {
    return { quantity, unit: baseUnit };
  }

  throw new InvalidUnitError(unit, [orderUnit, baseUnit]);
}

/**
 * Normalize a requested quantity and unit to the canonical purchasing unit.
 *
 * - If the user specifies the order unit directly → compute base unit quantity.
 * - If the user specifies the base unit → convert to order units, requiring
 *   an exact multiple. Throws NonExactPackMultipleError if not exact.
 */
export function normalizeRequestedQuantity(
  quantity: number,
  unit: string,
  product: ProductUnitInfo
): NormalizedQuantity {
  if (quantity <= 0) {
    throw new InvalidQuantityError(
      `Quantity must be a positive number, got ${quantity}`
    );
  }

  const { orderUnit, baseUnit, baseUnitsPerBme } = product;
  const unitLower = unit.toLowerCase();

  if (unitLower === orderUnit.toLowerCase()) {
    return {
      quantity,
      orderUnit,
      baseUnitQuantity: quantity * baseUnitsPerBme,
    };
  }

  if (unitLower === baseUnit.toLowerCase()) {
    if (quantity % baseUnitsPerBme !== 0) {
      throw new NonExactPackMultipleError(
        quantity,
        baseUnit,
        orderUnit,
        baseUnitsPerBme
      );
    }
    return {
      quantity: quantity / baseUnitsPerBme,
      orderUnit,
      baseUnitQuantity: quantity,
    };
  }

  throw new InvalidUnitError(unit, [orderUnit, baseUnit]);
}
