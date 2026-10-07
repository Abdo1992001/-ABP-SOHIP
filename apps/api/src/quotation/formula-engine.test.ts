import { describe, expect, it } from "vitest";
import { Prisma } from "@abp/database";
import {
  evaluateFormula,
  FormulaError,
  validateFormula,
} from "./formula-engine.js";
import {
  buildLineFormulaScope,
  FORMULA_VARIABLE_NAMES,
} from "./formula-scope.js";

const d = (value: string | number): Prisma.Decimal => new Prisma.Decimal(value);

describe("evaluateFormula", () => {
  const scope = { a: d(10), b: d(4), zero: d(0) };

  it("does the four operations with the usual precedence", () => {
    expect(evaluateFormula("2 + 3 * 4", {}).toString()).toBe("14");
    expect(evaluateFormula("(2 + 3) * 4", {}).toString()).toBe("20");
    expect(evaluateFormula("a - b / 2", scope).toString()).toBe("8");
  });

  it("reads variables out of the scope it was given", () => {
    expect(evaluateFormula("a * b", scope).toString()).toBe("40");
  });

  it("handles unary minus and right-associative powers", () => {
    expect(evaluateFormula("-a + 12", scope).toString()).toBe("2");
    expect(evaluateFormula("2 ^ 3 ^ 2", {}).toString()).toBe("512");
  });

  it("keeps decimal precision instead of drifting into binary floats", () => {
    // 0.1 + 0.2 is famously 0.30000000000000004 in a double.
    expect(evaluateFormula("0.1 + 0.2", {}).toString()).toBe("0.3");
  });

  it("supports the functions a pricing rule actually needs", () => {
    expect(evaluateFormula("ceil(2500 / 1220)", {}).toString()).toBe("3");
    expect(evaluateFormula("floor(2500 / 1220)", {}).toString()).toBe("2");
    expect(evaluateFormula("round(2.5)", {}).toString()).toBe("3");
    expect(evaluateFormula("max(1, 7, 3)", {}).toString()).toBe("7");
    expect(evaluateFormula("min(1, 7, 3)", {}).toString()).toBe("1");
    expect(evaluateFormula("abs(0 - 5)", {}).toString()).toBe("5");
  });

  it("knows pi", () => {
    expect(evaluateFormula("pi * 1200", {}).toFixed(3)).toBe("3769.911");
  });

  it("refuses a variable the item does not provide", () => {
    expect(() => evaluateFormula("a * missing", scope)).toThrow(FormulaError);
    try {
      evaluateFormula("a * missing", scope);
    } catch (error) {
      expect((error as FormulaError).code).toBe("UNKNOWN_VARIABLE");
      expect((error as FormulaError).symbol).toBe("missing");
    }
  });

  it("refuses a function it does not define", () => {
    try {
      evaluateFormula("nope(1)", {});
      expect.unreachable();
    } catch (error) {
      expect((error as FormulaError).code).toBe("UNKNOWN_FUNCTION");
    }
  });

  it("refuses division by zero rather than returning Infinity", () => {
    try {
      evaluateFormula("a / zero", scope);
      expect.unreachable();
    } catch (error) {
      expect((error as FormulaError).code).toBe("DIVIDE_BY_ZERO");
    }
  });

  it("refuses malformed input instead of guessing", () => {
    for (const bad of ["2 +", "(2 + 3", "2 3", "* 4", ""]) {
      expect(() => evaluateFormula(bad, {})).toThrow(FormulaError);
    }
  });

  it("never reaches the host, whatever the string says", () => {
    // These all parse as names or characters the grammar does not accept.
    // None of them can call anything, because nothing in the evaluator hands
    // a string to the JavaScript runtime.
    for (const attack of [
      "process.exit(1)",
      "globalThis",
      "constructor",
      "this",
      "require('fs')",
      "a[0]",
      "()=>1",
      "1;2",
    ]) {
      expect(() => evaluateFormula(attack, { a: d(1) })).toThrow(FormulaError);
    }
  });

  it("refuses an absurdly long expression", () => {
    try {
      evaluateFormula("1+".repeat(400) + "1", {});
      expect.unreachable();
    } catch (error) {
      expect((error as FormulaError).code).toBe("TOO_LONG");
    }
  });
});

describe("buildLineFormulaScope", () => {
  const scope = buildLineFormulaScope({
    widthMm: d(1220),
    lengthMm: d(2440),
    thicknessMm: d(18),
    densityKgM3: d(720),
    quantity: d(10),
    rate: d(90),
    fabricationCost: d(150),
  });

  it("converts millimetres to the units a price is quoted in", () => {
    expect(scope.area?.toString()).toBe("2.9768");
    expect(scope.volume?.toFixed(6)).toBe("0.053582");
    expect(scope.weight?.toFixed(6)).toBe("38.579328");
  });

  it("derives diameter from radius and back", () => {
    const fromRadius = buildLineFormulaScope({ radiusMm: d(600) });
    expect(fromRadius.diameter?.toString()).toBe("1200");
    const fromDiameter = buildLineFormulaScope({ diameterMm: d(1200) });
    expect(fromDiameter.radius?.toString()).toBe("600");
  });

  it("accepts the specification's own snake_case spellings", () => {
    expect(evaluateFormula("area_m2 * 100", scope).toString()).toBe("297.68");
    expect(evaluateFormula("weight_kg * rate", scope).toFixed(2)).toBe(
      "3472.14",
    );
  });

  it("prices the specification's worked examples", () => {
    // price_by_area
    expect(evaluateFormula("area * 250", scope).toString()).toBe("744.2");
    // price_by_weight_plus_fabrication
    expect(
      evaluateFormula("weight * rate + fabricationCost", scope).toFixed(2),
    ).toBe("3622.14");
    // a flat price per piece
    expect(evaluateFormula("quantity * 500", scope).toString()).toBe("5000");
  });
});

describe("validateFormula", () => {
  it("accepts a formula that only uses what a line provides", () => {
    expect(validateFormula("area * rate", FORMULA_VARIABLE_NAMES)).toEqual({
      ok: true,
    });
  });

  it("names the variable it could not resolve", () => {
    const result = validateFormula("area * markup", FORMULA_VARIABLE_NAMES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNKNOWN_VARIABLE");
      expect(result.symbol).toBe("markup");
    }
  });

  it("catches a syntax error before it reaches a quotation", () => {
    const result = validateFormula("area * ", FORMULA_VARIABLE_NAMES);
    expect(result.ok).toBe(false);
  });
});
