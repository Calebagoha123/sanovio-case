import { z } from "zod";
import { DuplicateBasketProductError } from "../errors";
import { getProductDetails } from "./get-product-details";
import { normalizeRequestedQuantity } from "../units/convert";

export const reorderRequestLineInput = z.object({
  internalId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  requestedUnit: z.string().min(1),
});

export interface PreparedReorderRequestLine {
  internalId: number;
  description: string;
  brand: string;
  quantity: number;
  orderUnit: string;
  baseUnit: string;
  baseUnitQuantity: number;
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string | null;
}

export interface BasketPriceSummary {
  currency: string | null;
  totalPrice: number | null;
}

export async function prepareReorderRequestLine(
  rawInput: z.input<typeof reorderRequestLineInput>
): Promise<PreparedReorderRequestLine> {
  const input = reorderRequestLineInput.parse(rawInput);
  const product = await getProductDetails(input.internalId);
  const normalized = normalizeRequestedQuantity(input.quantity, input.requestedUnit, {
    orderUnit: product.orderUnit,
    baseUnit: product.baseUnit,
    baseUnitsPerBme: product.baseUnitsPerBme,
  });
  const totalPrice =
    product.netTargetPrice === null ? null : Number((product.netTargetPrice * normalized.quantity).toFixed(2));

  return {
    internalId: product.internalId,
    description: product.description,
    brand: product.brand,
    quantity: normalized.quantity,
    orderUnit: normalized.orderUnit,
    baseUnit: product.baseUnit,
    baseUnitQuantity: normalized.baseUnitQuantity,
    unitPrice: product.netTargetPrice,
    totalPrice,
    currency: product.currency ?? null,
  };
}

export async function prepareReorderRequestLines(
  rawItems: Array<z.input<typeof reorderRequestLineInput>>
): Promise<PreparedReorderRequestLine[]> {
  const items = z.array(reorderRequestLineInput).min(1).parse(rawItems);
  const seen = new Set<number>();

  for (const item of items) {
    if (seen.has(item.internalId)) {
      throw new DuplicateBasketProductError(item.internalId);
    }
    seen.add(item.internalId);
  }

  return Promise.all(items.map((item) => prepareReorderRequestLine(item)));
}

export function summarizePreparedReorderLines(
  items: PreparedReorderRequestLine[]
): BasketPriceSummary {
  if (items.length === 0) {
    return { currency: null, totalPrice: null };
  }

  const currency = items[0].currency;
  if (
    currency === null ||
    items.some((item) => item.currency !== currency || item.totalPrice === null)
  ) {
    return { currency: null, totalPrice: null };
  }

  return {
    currency,
    totalPrice: Number(items.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0).toFixed(2)),
  };
}
