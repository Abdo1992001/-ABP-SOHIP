import { Prisma } from "@abp/database";

/**
 * A calculator for pricing formulas that are DATA, not code.
 *
 * ACROW does not only sell boards by the kilogram. The same quotation may need
 * a price by square metre, by cubic metre, by linear metre, a flat price per
 * piece, or weight plus a fabrication charge — and the next one will need
 * something nobody has thought of yet. Shipping a release for each of those is
 * how a pricing system stops being used.
 *
 * So a formula is a stored string, and this evaluates it.
 *
 * WHAT THIS DELIBERATELY IS NOT: `eval`, `new Function`, or anything else that
 * hands a stored string to the JavaScript runtime. A formula comes out of the
 * database and is written by whoever has permission to write formulas; the
 * blast radius of a mistake there has to be "the number is wrong", never "the
 * server ran it". This is a hand-written recursive-descent parser over a fixed
 * grammar, with a fixed function list and a fixed variable set. There is no
 * property access, no call into anything it did not define, and no way to
 * reach the host from inside an expression.
 *
 * Arithmetic is Decimal throughout, because these produce money.
 *
 *   area * rate
 *   weight * rate + fabricationCost
 *   ceil(length / 2440) * boardPrice
 *   max(quantity, 1) * fixedCost
 */

export type FormulaErrorCode =
  | "EMPTY_EXPRESSION"
  | "SYNTAX"
  | "UNKNOWN_VARIABLE"
  | "UNKNOWN_FUNCTION"
  | "BAD_ARGUMENT_COUNT"
  | "DIVIDE_BY_ZERO"
  | "NOT_FINITE"
  | "TOO_LONG";

export class FormulaError extends Error {
  constructor(
    readonly code: FormulaErrorCode,
    message: string,
    /** The variable or function the failure is about, when it is about one. */
    readonly symbol?: string,
  ) {
    super(message);
    this.name = "FormulaError";
  }
}

/** Long enough for any real pricing rule, short enough that nothing pathological parses. */
const MAX_EXPRESSION_LENGTH = 500;

export type FormulaScope = Readonly<Record<string, Prisma.Decimal>>;

const PI = new Prisma.Decimal("3.14159265358979323846");

/* ── tokenizer ─────────────────────────────────────────────────────────── */

type Token =
  | { kind: "number"; value: Prisma.Decimal }
  | { kind: "name"; value: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "^" }
  | { kind: "paren"; value: "(" | ")" }
  | { kind: "comma" };

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";
const isNameStart = (ch: string): boolean =>
  (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
const isNameChar = (ch: string): boolean => isNameStart(ch) || isDigit(ch);

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const ch = expression[index] ?? "";
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (isDigit(ch) || (ch === "." && isDigit(expression[index + 1] ?? ""))) {
      let end = index;
      let seenDot = false;
      while (end < expression.length) {
        const c = expression[end] ?? "";
        if (isDigit(c)) {
          end += 1;
          continue;
        }
        if (c === "." && !seenDot) {
          seenDot = true;
          end += 1;
          continue;
        }
        break;
      }
      tokens.push({
        kind: "number",
        value: new Prisma.Decimal(expression.slice(index, end)),
      });
      index = end;
      continue;
    }
    if (isNameStart(ch)) {
      let end = index;
      while (end < expression.length && isNameChar(expression[end] ?? ""))
        end += 1;
      tokens.push({ kind: "name", value: expression.slice(index, end) });
      index = end;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ kind: "op", value: ch });
      index += 1;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", value: ch });
      index += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      index += 1;
      continue;
    }
    throw new FormulaError("SYNTAX", `Unexpected character "${ch}".`, ch);
  }
  return tokens;
}

/* ── functions ─────────────────────────────────────────────────────────── */

interface FormulaFunction {
  arity: number | "variadic";
  apply: (args: Prisma.Decimal[]) => Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

const FUNCTIONS: Readonly<Record<string, FormulaFunction>> = {
  ceil: { arity: 1, apply: ([a]) => (a ?? ZERO).ceil() },
  floor: { arity: 1, apply: ([a]) => (a ?? ZERO).floor() },
  round: {
    arity: 1,
    apply: ([a]) =>
      (a ?? ZERO).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP),
  },
  abs: { arity: 1, apply: ([a]) => (a ?? ZERO).abs() },
  sqrt: { arity: 1, apply: ([a]) => (a ?? ZERO).sqrt() },
  min: {
    arity: "variadic",
    apply: (args) =>
      args.reduce((best, value) => (value.lessThan(best) ? value : best)),
  },
  max: {
    arity: "variadic",
    apply: (args) =>
      args.reduce((best, value) => (value.greaterThan(best) ? value : best)),
  },
};

/** Names an expression may use without the caller supplying them. */
const CONSTANTS: Readonly<Record<string, Prisma.Decimal>> = { pi: PI };

/**
 * A plain object inherits from Object.prototype, so `scope["constructor"]`
 * hands back the Object constructor and `FUNCTIONS["constructor"]` hands back
 * something with a very real `.apply`. A formula is attacker-adjacent input;
 * it only ever gets to see names the object owns itself.
 */
function own<T>(
  record: Readonly<Record<string, T>>,
  name: string,
): T | undefined {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

/** Every function and constant a formula author may write. */
export const FORMULA_FUNCTION_NAMES = Object.keys(FUNCTIONS);
export const FORMULA_CONSTANT_NAMES = Object.keys(CONSTANTS);

/* ── parser ────────────────────────────────────────────────────────────── */

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly scope: FormulaScope,
  ) {}

  parse(): Prisma.Decimal {
    const value = this.expression();
    if (this.position < this.tokens.length)
      throw new FormulaError("SYNTAX", "Unexpected trailing input.");
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private expression(): Prisma.Decimal {
    let left = this.term();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || (token.value !== "+" && token.value !== "-"))
        return left;
      this.position += 1;
      const right = this.term();
      left = token.value === "+" ? left.plus(right) : left.minus(right);
    }
  }

  private term(): Prisma.Decimal {
    let left = this.power();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || (token.value !== "*" && token.value !== "/"))
        return left;
      this.position += 1;
      const right = this.power();
      if (token.value === "/") {
        if (right.isZero())
          throw new FormulaError("DIVIDE_BY_ZERO", "Division by zero.");
        left = left.div(right);
      } else {
        left = left.mul(right);
      }
    }
  }

  /** Right-associative, so 2^3^2 is 2^9, as every calculator agrees. */
  private power(): Prisma.Decimal {
    const base = this.unary();
    const token = this.peek();
    if (token?.kind === "op" && token.value === "^") {
      this.position += 1;
      return base.pow(this.power());
    }
    return base;
  }

  private unary(): Prisma.Decimal {
    const token = this.peek();
    if (token?.kind === "op" && (token.value === "-" || token.value === "+")) {
      this.position += 1;
      const value = this.unary();
      return token.value === "-" ? value.negated() : value;
    }
    return this.primary();
  }

  private primary(): Prisma.Decimal {
    const token = this.peek();
    if (token === undefined)
      throw new FormulaError("SYNTAX", "Expression ended early.");

    if (token.kind === "number") {
      this.position += 1;
      return token.value;
    }

    if (token.kind === "paren" && token.value === "(") {
      this.position += 1;
      const value = this.expression();
      const closing = this.peek();
      if (closing?.kind !== "paren" || closing.value !== ")")
        throw new FormulaError("SYNTAX", "Missing closing parenthesis.");
      this.position += 1;
      return value;
    }

    if (token.kind === "name") {
      this.position += 1;
      const next = this.peek();
      if (next?.kind === "paren" && next.value === "(")
        return this.call(token.value);
      const constant = own(CONSTANTS, token.value);
      if (constant !== undefined) return constant;
      const bound = own(this.scope, token.value);
      if (bound === undefined)
        throw new FormulaError(
          "UNKNOWN_VARIABLE",
          `This formula uses "${token.value}", which this item does not provide.`,
          token.value,
        );
      return bound;
    }

    throw new FormulaError("SYNTAX", "Unexpected token.");
  }

  private call(name: string): Prisma.Decimal {
    const fn = own(FUNCTIONS, name);
    if (fn === undefined)
      throw new FormulaError(
        "UNKNOWN_FUNCTION",
        `There is no function called "${name}".`,
        name,
      );
    this.position += 1; // consume "("
    const args: Prisma.Decimal[] = [];
    const first = this.peek();
    if (first?.kind === "paren" && first.value === ")") {
      this.position += 1;
    } else {
      for (;;) {
        args.push(this.expression());
        const next = this.peek();
        if (next?.kind === "comma") {
          this.position += 1;
          continue;
        }
        if (next?.kind === "paren" && next.value === ")") {
          this.position += 1;
          break;
        }
        throw new FormulaError(
          "SYNTAX",
          `Malformed arguments to "${name}".`,
          name,
        );
      }
    }
    if (fn.arity === "variadic") {
      if (args.length === 0)
        throw new FormulaError(
          "BAD_ARGUMENT_COUNT",
          `"${name}" needs at least one argument.`,
          name,
        );
    } else if (args.length !== fn.arity) {
      throw new FormulaError(
        "BAD_ARGUMENT_COUNT",
        `"${name}" takes ${String(fn.arity)} argument(s), got ${String(args.length)}.`,
        name,
      );
    }
    return fn.apply(args);
  }
}

/* ── entry point ───────────────────────────────────────────────────────── */

export function evaluateFormula(
  expression: string,
  scope: FormulaScope,
): Prisma.Decimal {
  const trimmed = expression.trim();
  if (trimmed === "")
    throw new FormulaError("EMPTY_EXPRESSION", "The formula is empty.");
  if (trimmed.length > MAX_EXPRESSION_LENGTH)
    throw new FormulaError(
      "TOO_LONG",
      `A formula may be at most ${String(MAX_EXPRESSION_LENGTH)} characters.`,
    );
  const value = new Parser(tokenize(trimmed), scope).parse();
  if (!value.isFinite())
    throw new FormulaError(
      "NOT_FINITE",
      "The formula produced no finite value.",
    );
  return value;
}

/**
 * Checks a formula without pricing anything, so whoever writes it finds out at
 * the moment they write it rather than on someone else's quotation. Every
 * variable is bound to 1 — the point is the grammar and the names, not the
 * number.
 */
export type FormulaValidation =
  | { ok: true }
  | { ok: false; code: FormulaErrorCode; message: string; symbol?: string };

export function validateFormula(
  expression: string,
  availableVariables: readonly string[],
): FormulaValidation {
  const one = new Prisma.Decimal(1);
  const scope: Record<string, Prisma.Decimal> = {};
  for (const name of availableVariables) scope[name] = one;
  try {
    evaluateFormula(expression, scope);
    return { ok: true };
  } catch (error) {
    if (error instanceof FormulaError)
      return error.symbol === undefined
        ? { ok: false, code: error.code, message: error.message }
        : {
            ok: false,
            code: error.code,
            message: error.message,
            symbol: error.symbol,
          };
    throw error;
  }
}
