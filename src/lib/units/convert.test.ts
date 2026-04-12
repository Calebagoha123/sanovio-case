import { describe, it, expect } from "vitest";
import {
  convertToBaseUnit,
  normalizeRequestedQuantity,
} from "./convert";
import {
  InvalidUnitError,
  InvalidQuantityError,
  NonExactPackMultipleError,
  ProductNotFoundError,
} from "../errors";

// Fixtures derived from the real Excel data (post-normalization)
// Product 1: box, 200 Piece/box  (Nitrile glove)
// Product 3: pack, 100 Piece/pack (Syringe)
// Product 5: box, 50 Piece/box   (OP mask)
// Product 10: role, 1 role/role  (Wound plaster — base == order unit)

const CATALOG: Record<
  number,
  { orderUnit: string; baseUnit: string; baseUnitsPerBme: number }
> = {
  1:  { orderUnit: "box",  baseUnit: "Piece", baseUnitsPerBme: 200 },
  3:  { orderUnit: "pack", baseUnit: "Piece", baseUnitsPerBme: 100 },
  5:  { orderUnit: "box",  baseUnit: "Piece", baseUnitsPerBme: 50  },
  10: { orderUnit: "role", baseUnit: "role",  baseUnitsPerBme: 1   },
};

describe("convertToBaseUnit", () => {
  it("converts 5 box of product 1 to 1000 Piece", () => {
    const result = convertToBaseUnit(5, "box", CATALOG[1]);
    expect(result).toEqual({ quantity: 1000, unit: "Piece" });
  });

  it("converts 1 pack of product 3 to 100 Piece", () => {
    const result = convertToBaseUnit(1, "pack", CATALOG[3]);
    expect(result).toEqual({ quantity: 100, unit: "Piece" });
  });

  it("converts 1 role of product 10 to 1 role (base == order unit)", () => {
    const result = convertToBaseUnit(1, "role", CATALOG[10]);
    expect(result).toEqual({ quantity: 1, unit: "role" });
  });

  it("accepts the base unit as input (treated as 1:1)", () => {
    const result = convertToBaseUnit(200, "Piece", CATALOG[1]);
    expect(result).toEqual({ quantity: 200, unit: "Piece" });
  });

  it("throws InvalidUnitError for an unrecognized unit", () => {
    expect(() => convertToBaseUnit(5, "palette", CATALOG[1])).toThrow(
      InvalidUnitError
    );
  });

  it("InvalidUnitError includes valid unit options", () => {
    try {
      convertToBaseUnit(5, "palette", CATALOG[1]);
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidUnitError);
      expect((e as InvalidUnitError).validUnits).toContain("box");
      expect((e as InvalidUnitError).validUnits).toContain("Piece");
    }
  });

  it("throws InvalidQuantityError for zero quantity", () => {
    expect(() => convertToBaseUnit(0, "box", CATALOG[1])).toThrow(
      InvalidQuantityError
    );
  });

  it("throws InvalidQuantityError for negative quantity", () => {
    expect(() => convertToBaseUnit(-3, "box", CATALOG[1])).toThrow(
      InvalidQuantityError
    );
  });
});

describe("normalizeRequestedQuantity", () => {
  it("canonicalizes an exact base-unit multiple to the purchasing unit", () => {
    // 1000 Piece of product 1 = exactly 5 box
    const result = normalizeRequestedQuantity(1000, "Piece", CATALOG[1]);
    expect(result).toEqual({
      quantity: 5,
      orderUnit: "box",
      baseUnitQuantity: 1000,
    });
  });

  it("passes through a valid order-unit quantity unchanged", () => {
    const result = normalizeRequestedQuantity(5, "box", CATALOG[1]);
    expect(result).toEqual({
      quantity: 5,
      orderUnit: "box",
      baseUnitQuantity: 1000,
    });
  });

  it("throws NonExactPackMultipleError for a non-exact base-unit amount", () => {
    // 900 Piece of product 1 is not divisible by 200
    expect(() => normalizeRequestedQuantity(900, "Piece", CATALOG[1])).toThrow(
      NonExactPackMultipleError
    );
  });

  it("NonExactPackMultipleError includes valid purchasing options", () => {
    try {
      normalizeRequestedQuantity(900, "Piece", CATALOG[1]);
    } catch (e) {
      expect(e).toBeInstanceOf(NonExactPackMultipleError);
      const err = e as NonExactPackMultipleError;
      // 900 / 200 = 4.5 → valid options are 4 box (800) and 5 box (1000)
      expect(err.validOptions).toContainEqual({ quantity: 4, orderUnit: "box" });
      expect(err.validOptions).toContainEqual({ quantity: 5, orderUnit: "box" });
    }
  });

  it("handles role unit where base == order (product 10)", () => {
    const result = normalizeRequestedQuantity(3, "role", CATALOG[10]);
    expect(result).toEqual({
      quantity: 3,
      orderUnit: "role",
      baseUnitQuantity: 3,
    });
  });
});
