// src/tools/utility.ts
import crypto from "node:crypto";
import type { Tool } from "../types.js";

/**
 * Evaluates mathematical expressions using a safe AST/recursive-descent parser.
 * NO eval() or Function() constructor is used.
 */
export function evaluateMath(expression: string): number {
  type TokenType = "NUMBER" | "OP" | "PAREN" | "IDENT" | "COMMA";
  interface Token {
    type: TokenType;
    value: string;
  }

  const tokens: Token[] = [];
  let i = 0;
  const str = expression.trim();

  while (i < str.length) {
    const ch = str[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(str[i + 1] || ""))) {
      let num = "";
      while (i < str.length && (/[0-9]/.test(str[i]) || str[i] === ".")) {
        num += str[i++];
      }
      tokens.push({ type: "NUMBER", value: num });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
        ident += str[i++];
      }
      tokens.push({ type: "IDENT", value: ident });
      continue;
    }

    if (str.startsWith("**", i)) {
      tokens.push({ type: "OP", value: "**" });
      i += 2;
      continue;
    }

    if ("+-*/%^".includes(ch)) {
      tokens.push({ type: "OP", value: ch });
      i++;
      continue;
    }

    if (ch === "(" || ch === ")") {
      tokens.push({ type: "PAREN", value: ch });
      i++;
      continue;
    }

    if (ch === ",") {
      tokens.push({ type: "COMMA", value: ch });
      i++;
      continue;
    }

    throw new Error(`Unexpected character "${ch}" in math expression`);
  }

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token | undefined => tokens[pos++];

  function parseExpression(): number {
    let result = parseTerm();
    while (peek() && peek()!.type === "OP" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = consume()!.value;
      const right = parseTerm();
      result = op === "+" ? result + right : result - right;
    }
    return result;
  }

  function parseTerm(): number {
    let result = parsePower();
    while (peek() && peek()!.type === "OP" && (peek()!.value === "*" || peek()!.value === "/" || peek()!.value === "%")) {
      const op = consume()!.value;
      const right = parsePower();
      if (op === "*") result *= right;
      else if (op === "/") {
        if (right === 0) throw new Error("Division by zero");
        result /= right;
      } else if (op === "%") {
        result %= right;
      }
    }
    return result;
  }

  function parsePower(): number {
    let result = parseUnary();
    while (peek() && peek()!.type === "OP" && (peek()!.value === "^" || peek()!.value === "**")) {
      consume();
      const right = parseUnary();
      result = Math.pow(result, right);
    }
    return result;
  }

  function parseUnary(): number {
    if (peek() && peek()!.type === "OP" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = consume()!.value;
      const factor = parsePrimary();
      return op === "-" ? -factor : factor;
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const token = consume();
    if (!token) throw new Error("Unexpected end of expression");

    if (token.type === "NUMBER") {
      const parsed = parseFloat(token.value);
      if (Number.isNaN(parsed)) throw new Error(`Invalid number: ${token.value}`);
      return parsed;
    }

    if (token.type === "IDENT") {
      const name = token.value.toUpperCase();
      if (name === "PI") return Math.PI;
      if (name === "E") return Math.E;

      if (peek() && peek()!.type === "PAREN" && peek()!.value === "(") {
        consume(); // (
        const args: number[] = [];
        if (!peek() || peek()!.value !== ")") {
          args.push(parseExpression());
          while (peek() && peek()!.type === "COMMA") {
            consume();
            args.push(parseExpression());
          }
        }
        const closing = consume();
        if (!closing || closing.value !== ")") throw new Error("Expected closing parenthesis");

        const fnName = token.value.toLowerCase();
        const fns: Record<string, (...args: number[]) => number> = {
          sqrt: Math.sqrt,
          abs: Math.abs,
          round: Math.round,
          floor: Math.floor,
          ceil: Math.ceil,
          sin: Math.sin,
          cos: Math.cos,
          tan: Math.tan,
          log: Math.log,
          min: Math.min,
          max: Math.max,
          pow: Math.pow,
        };
        if (!(fnName in fns)) {
          throw new Error(`Unsupported math function: ${token.value}`);
        }
        return fns[fnName](...args);
      }
      throw new Error(`Unknown variable: ${token.value}`);
    }

    if (token.type === "PAREN" && token.value === "(") {
      const val = parseExpression();
      const closing = consume();
      if (!closing || closing.value !== ")") throw new Error("Missing closing parenthesis");
      return val;
    }

    throw new Error(`Unexpected token "${token.value}"`);
  }

  const res = parseExpression();
  if (pos < tokens.length) {
    throw new Error(`Unexpected extra input "${tokens[pos].value}"`);
  }
  return res;
}

export const calculateTool: Tool = {
  name: "calculate",
  description: "Evaluate a simple math expression (e.g. '12 * 7 + 3', 'sqrt(16) + 5')",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Math expression" },
    },
    required: ["expression"],
  },
  execute: async ({ expression }: { expression: string }) => {
    if (!expression || typeof expression !== "string") {
      return "Error: Expression string is required";
    }
    try {
      const result = evaluateMath(expression);
      return String(result);
    } catch (error: any) {
      return `Error: ${error.message || "Invalid math expression"}`;
    }
  },
};

export const getCurrentTimeTool: Tool = {
  name: "get_current_time",
  description: "Get the current date and time",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    return new Date().toLocaleString();
  },
};

export const getRandomNumberTool: Tool = {
  name: "get_random_number",
  description: "Get a random integer between min and max (inclusive)",
  parameters: {
    type: "object",
    properties: {
      min: { type: "number", description: "Minimum value" },
      max: { type: "number", description: "Maximum value" },
    },
    required: ["min", "max"],
  },
  execute: async ({ min, max }: { min: number; max: number }) => {
    if (typeof min !== "number" || typeof max !== "number") {
      return "Error: min and max must be numbers";
    }
    if (min > max) [min, max] = [max, min];
    const random = Math.floor(Math.random() * (max - min + 1)) + min;
    return String(random);
  },
};

export const getUuidTool: Tool = {
  name: "get_uuid",
  description: "Generate a UUID v4",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  execute: async () => {
    return crypto.randomUUID();
  },
};

export const generatePasswordTool: Tool = {
  name: "generate_password",
  description: "Generate a cryptographically secure random password with configurable options.",
  parameters: {
    type: "object",
    properties: {
      length: {
        type: "number",
        description: "Password length (8-128). Default: 16",
        default: 16,
        minimum: 8,
        maximum: 128,
      },
      includeUppercase: {
        type: "boolean",
        description: "Include uppercase letters (A-Z). Default: true",
        default: true,
      },
      includeLowercase: {
        type: "boolean",
        description: "Include lowercase letters (a-z). Default: true",
        default: true,
      },
      includeNumbers: {
        type: "boolean",
        description: "Include numbers (0-9). Default: true",
        default: true,
      },
      includeSymbols: {
        type: "boolean",
        description: "Include special symbols (!@#$%^&*). Default: true",
        default: true,
      },
      excludeSimilar: {
        type: "boolean",
        description: "Exclude similar-looking characters (l, 1, I, O, 0, etc.). Default: false",
        default: false,
      },
    },
    required: [],
  },
  execute: async ({
    length = 16,
    includeUppercase = true,
    includeLowercase = true,
    includeNumbers = true,
    includeSymbols = true,
    excludeSimilar = false,
  }: {
    length?: number;
    includeUppercase?: boolean;
    includeLowercase?: boolean;
    includeNumbers?: boolean;
    includeSymbols?: boolean;
    excludeSimilar?: boolean;
  }) => {
    if (length < 8 || length > 128) {
      return "Error: Length must be between 8 and 128";
    }

    let uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let lowercase = "abcdefghijklmnopqrstuvwxyz";
    let numbers = "0123456789";
    let symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";

    if (excludeSimilar) {
      uppercase = uppercase.replace(/[IL]/g, "");
      lowercase = lowercase.replace(/[il]/g, "");
      numbers = numbers.replace(/[01]/g, "");
      symbols = symbols.replace(/[|]/g, "");
    }

    let charset = "";
    if (includeUppercase) charset += uppercase;
    if (includeLowercase) charset += lowercase;
    if (includeNumbers) charset += numbers;
    if (includeSymbols) charset += symbols;

    if (charset.length === 0) {
      return "Error: At least one character type must be enabled";
    }

    const bytes = crypto.randomBytes(length);
    let password = "";
    for (let i = 0; i < length; i++) {
      password += charset[bytes[i] % charset.length];
    }

    const checks = [
      { enabled: includeUppercase, set: uppercase },
      { enabled: includeLowercase, set: lowercase },
      { enabled: includeNumbers, set: numbers },
      { enabled: includeSymbols, set: symbols },
    ];

    for (const check of checks) {
      if (check.enabled && !check.set.split("").some((c) => password.includes(c))) {
        const pos = crypto.randomInt(0, length);
        const char = check.set[crypto.randomInt(0, check.set.length)];
        password = password.slice(0, pos) + char + password.slice(pos + 1);
      }
    }

    return password;
  },
};

export const utilityTools: Tool[] = [
  getCurrentTimeTool,
  calculateTool,
  getRandomNumberTool,
  getUuidTool,
  generatePasswordTool,
];
