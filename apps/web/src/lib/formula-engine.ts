/**
 * Client-side mirror of apps/api/src/quotation/formula-engine.ts.
 *
 * Same grammar, same function list, same refusals — arithmetic in plain
 * numbers rather than Decimal, because this only ever draws a preview. The
 * server recomputes every formula on save and its result is the one that
 * reaches a customer, exactly as with the weight and rate previews beside it.
 *
 * It is still a hand-written parser and not `eval`: a formula is text that
 * arrives over the network, and handing that to the JavaScript runtime in
 * someone's browser is not a thing to do for a preview.
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
    readonly symbol?: string,
  ) {
    super(message);
    this.name = "FormulaError";
  }
}

const MAX_EXPRESSION_LENGTH = 500;

export type FormulaScope = Readonly<Record<string, number>>;

type Token =
  | { kind: "number"; value: number }
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
        value: Number(expression.slice(index, end)),
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

interface FormulaFunction {
  arity: number | "variadic";
  apply: (args: number[]) => number;
}

const FUNCTIONS: Readonly<Record<string, FormulaFunction>> = {
  ceil: { arity: 1, apply: ([a]) => Math.ceil(a ?? 0) },
  floor: { arity: 1, apply: ([a]) => Math.floor(a ?? 0) },
  round: { arity: 1, apply: ([a]) => Math.round(a ?? 0) },
  abs: { arity: 1, apply: ([a]) => Math.abs(a ?? 0) },
  sqrt: { arity: 1, apply: ([a]) => Math.sqrt(a ?? 0) },
  min: { arity: "variadic", apply: (args) => Math.min(...args) },
  max: { arity: "variadic", apply: (args) => Math.max(...args) },
};

const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI };

/**
 * A plain object inherits from Object.prototype, so `scope["constructor"]`
 * hands back the Object constructor. A formula only ever sees names the
 * object owns itself.
 */
function own<T>(
  record: Readonly<Record<string, T>>,
  name: string,
): T | undefined {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

export const FORMULA_FUNCTION_NAMES = Object.keys(FUNCTIONS);
export const FORMULA_CONSTANT_NAMES = Object.keys(CONSTANTS);

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly scope: FormulaScope,
  ) {}

  parse(): number {
    const value = this.expression();
    if (this.position < this.tokens.length)
      throw new FormulaError("SYNTAX", "Unexpected trailing input.");
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private expression(): number {
    let left = this.term();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || (token.value !== "+" && token.value !== "-"))
        return left;
      this.position += 1;
      const right = this.term();
      left = token.value === "+" ? left + right : left - right;
    }
  }

  private term(): number {
    let left = this.power();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || (token.value !== "*" && token.value !== "/"))
        return left;
      this.position += 1;
      const right = this.power();
      if (token.value === "/") {
        if (right === 0)
          throw new FormulaError("DIVIDE_BY_ZERO", "Division by zero.");
        left = left / right;
      } else {
        left = left * right;
      }
    }
  }

  /** Right-associative, so 2^3^2 is 2^9. */
  private power(): number {
    const base = this.unary();
    const token = this.peek();
    if (token?.kind === "op" && token.value === "^") {
      this.position += 1;
      return base ** this.power();
    }
    return base;
  }

  private unary(): number {
    const token = this.peek();
    if (token?.kind === "op" && (token.value === "-" || token.value === "+")) {
      this.position += 1;
      const value = this.unary();
      return token.value === "-" ? -value : value;
    }
    return this.primary();
  }

  private primary(): number {
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

  private call(name: string): number {
    const fn = own(FUNCTIONS, name);
    if (fn === undefined)
      throw new FormulaError(
        "UNKNOWN_FUNCTION",
        `There is no function called "${name}".`,
        name,
      );
    this.position += 1;
    const args: number[] = [];
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

export function evaluateFormula(
  expression: string,
  scope: FormulaScope,
): number {
  const trimmed = expression.trim();
  if (trimmed === "")
    throw new FormulaError("EMPTY_EXPRESSION", "The formula is empty.");
  if (trimmed.length > MAX_EXPRESSION_LENGTH)
    throw new FormulaError(
      "TOO_LONG",
      `A formula may be at most ${String(MAX_EXPRESSION_LENGTH)} characters.`,
    );
  const value = new Parser(tokenize(trimmed), scope).parse();
  if (!Number.isFinite(value))
    throw new FormulaError(
      "NOT_FINITE",
      "The formula produced no finite value.",
    );
  return value;
}

/** Evaluates without throwing, for a preview that must never break the page. */
export function tryEvaluateFormula(
  expression: string,
  scope: FormulaScope,
):
  | { ok: true; value: number }
  | { ok: false; code: FormulaErrorCode; message: string } {
  try {
    return { ok: true, value: evaluateFormula(expression, scope) };
  } catch (error) {
    if (error instanceof FormulaError)
      return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}
