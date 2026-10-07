import type {
  DataQueryResult,
  QueryDslError,
  QueryDslField,
  Token,
} from "./types";

/** Maximum characters accepted in one DSL field. */
export const MAX_FIELD_LENGTH = 10_000;

const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;
const WHITESPACE = /[ \t]/;
const NUMBER_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const INDEX_PATTERN = /^\d+/;

/** PostgreSQL JSON operators, each mapped to the DSL form to use instead. */
const JSON_OPERATOR_HINTS: { operator: string; message: string }[] = [
  {
    operator: "->>",
    message: "Use a dot path instead of ->>, for example payload.status.",
  },
  {
    operator: "->",
    message: "Use a dot path instead of ->, for example payload.status.",
  },
  {
    operator: "#>",
    message:
      "Use a dot path instead of #> or #>>, for example payload.items.0.",
  },
  { operator: "#-", message: "Editing JSON values is not supported." },
  { operator: "@>", message: "Use CONTAINS instead of @>." },
  { operator: "<@", message: "<@ is not supported. Use CONTAINS instead." },
  { operator: "@", message: "JSONPath and @ operators are not supported." },
  {
    operator: "?|",
    message: "Use HAS with OR instead of ?|: tags HAS 'a' OR tags HAS 'b'.",
  },
  {
    operator: "?&",
    message: "Use HAS with AND instead of ?&: tags HAS 'a' AND tags HAS 'b'.",
  },
  { operator: "?", message: "Use HAS 'key' instead of ?." },
];

function error(
  field: QueryDslField,
  code: QueryDslError["code"],
  message: string,
  from: number,
  to: number,
): DataQueryResult<Token[]> {
  return { ok: false, errors: [{ code, field, message, from, to }] };
}

/**
 * Splits one DSL field into tokens with source ranges. Anything outside the
 * grammar's lexical rules (comments, semicolons, casts, dollar quotes,
 * newlines…) is rejected here so it can never reach the parser.
 */
export function tokenize(
  field: QueryDslField,
  input: string,
): DataQueryResult<Token[]> {
  if (input.length > MAX_FIELD_LENGTH) {
    return error(
      field,
      "limit-exceeded",
      `Keep this field under ${MAX_FIELD_LENGTH.toLocaleString("en-US")} characters.`,
      MAX_FIELD_LENGTH,
      input.length,
    );
  }

  const tokens: Token[] = [];
  let position = 0;
  // Where the last column name or path segment ended; a `.` exactly here
  // continues a path.
  let pathEnd = -1;

  while (position < input.length) {
    const char = input[position]!;
    const next = input[position + 1] ?? "";
    const start = position;

    if (WHITESPACE.test(char)) {
      position += 1;
      continue;
    }

    if (char === "\n" || char === "\r") {
      return error(
        field,
        "unsupported-syntax",
        "Newlines are not supported. Keep the expression on one line.",
        start,
        start + 1,
      );
    }

    if ((char === "-" && next === "-") || (char === "/" && next === "*")) {
      return error(
        field,
        "unsupported-syntax",
        "Comments are not supported.",
        start,
        input.length,
      );
    }

    if (char === ";") {
      return error(
        field,
        "unsupported-syntax",
        "Semicolons are not supported. Enter a single expression.",
        start,
        start + 1,
      );
    }

    if (char === ":" && next === ":") {
      return error(
        field,
        "unsupported-syntax",
        "Casts are not supported. Write the value as a quoted string.",
        start,
        start + 2,
      );
    }

    if (char === "$") {
      return error(
        field,
        "unsupported-syntax",
        "Dollar-quoted strings and parameters are not supported.",
        start,
        start + 1,
      );
    }

    if (char === "\\") {
      return error(
        field,
        "unsupported-syntax",
        "Backslash escapes are not supported. Double a quote to escape it: ''.",
        start,
        start + 1,
      );
    }

    const hint = JSON_OPERATOR_HINTS.find(({ operator }) =>
      input.startsWith(operator, position),
    );
    if (hint) {
      return error(
        field,
        "unsupported-syntax",
        hint.message,
        start,
        start + hint.operator.length,
      );
    }

    if (char === "." && start === pathEnd) {
      tokens.push({ kind: "dot", range: { from: start, to: start + 1 } });
      position += 1;
      const segmentStart = input[position] ?? "";
      if (IDENTIFIER_START.test(segmentStart) || segmentStart === '"') {
        continue;
      }
      if (!DIGIT.test(segmentStart)) {
        return error(
          field,
          "unexpected-token",
          'Expected a key or an index right after ".".',
          start,
          start + 1,
        );
      }
      const digits = INDEX_PATTERN.exec(input.slice(position))![0];
      position += digits.length;
      if (IDENTIFIER_PART.test(input[position] ?? "")) {
        while (
          position < input.length &&
          IDENTIFIER_PART.test(input[position]!)
        ) {
          position += 1;
        }
        return error(
          field,
          "unexpected-token",
          `Quote a key that starts with a digit: "${input.slice(start + 1, position)}".`,
          start + 1,
          position,
        );
      }
      tokens.push({
        kind: "number",
        value: digits,
        range: { from: start + 1, to: position },
      });
      pathEnd = position;
      continue;
    }

    const previous = tokens.at(-1);
    const spacedPath =
      char === "." &&
      !DIGIT.test(next) &&
      (previous?.kind === "word" || previous?.kind === "quoted-identifier");
    if (spacedPath) {
      return error(
        field,
        "unsupported-syntax",
        `Paths can't contain spaces. Write them as payload.key, with no spaces around ".".`,
        start,
        start + 1,
      );
    }

    if (char === "'") {
      let value = "";
      position += 1;
      let closed = false;
      while (position < input.length) {
        const current = input[position]!;
        if (current === "\n" || current === "\r") break;
        if (current === "'") {
          if (input[position + 1] === "'") {
            value += "'";
            position += 2;
            continue;
          }
          position += 1;
          closed = true;
          break;
        }
        value += current;
        position += 1;
      }
      if (!closed) {
        return error(
          field,
          "unterminated-string",
          "This string is missing its closing single quote.",
          start,
          input.length,
        );
      }
      tokens.push({
        kind: "string",
        value,
        range: { from: start, to: position },
      });
      continue;
    }

    if (char === '"') {
      let value = "";
      position += 1;
      let closed = false;
      while (position < input.length) {
        const current = input[position]!;
        if (current === "\n" || current === "\r") break;
        if (current === '"') {
          if (input[position + 1] === '"') {
            value += '"';
            position += 2;
            continue;
          }
          position += 1;
          closed = true;
          break;
        }
        value += current;
        position += 1;
      }
      if (!closed) {
        return error(
          field,
          "unterminated-identifier",
          "This quoted column name is missing its closing double quote.",
          start,
          input.length,
        );
      }
      if (value.length === 0) {
        return error(
          field,
          "empty-identifier",
          "A quoted column name cannot be empty.",
          start,
          position,
        );
      }
      tokens.push({
        kind: "quoted-identifier",
        value,
        range: { from: start, to: position },
      });
      pathEnd = position;
      continue;
    }

    // `-name` / `-"Name"` in Project excludes a column (MongoDB style).
    const startsExclusion =
      field === "projection" &&
      char === "-" &&
      (IDENTIFIER_START.test(next) || next === '"');
    if (startsExclusion) {
      tokens.push({ kind: "exclude", range: { from: start, to: start + 1 } });
      position += 1;
      continue;
    }

    const startsNumber =
      DIGIT.test(char) ||
      (char === "." && DIGIT.test(next)) ||
      (char === "-" && (DIGIT.test(next) || next === "."));
    if (startsNumber) {
      const match = NUMBER_PATTERN.exec(input.slice(position));
      if (!match) {
        return error(
          field,
          "unexpected-character",
          `Unexpected "${char}".`,
          start,
          start + 1,
        );
      }
      position += match[0].length;
      const trailing = input[position] ?? "";
      if (IDENTIFIER_PART.test(trailing) || trailing === ".") {
        while (
          position < input.length &&
          (IDENTIFIER_PART.test(input[position]!) || input[position] === ".")
        ) {
          position += 1;
        }
        return error(
          field,
          "unexpected-token",
          `"${input.slice(start, position)}" is not a valid number.`,
          start,
          position,
        );
      }
      tokens.push({
        kind: "number",
        value: match[0],
        range: { from: start, to: position },
      });
      continue;
    }

    if (IDENTIFIER_START.test(char)) {
      while (
        position < input.length &&
        IDENTIFIER_PART.test(input[position]!)
      ) {
        position += 1;
      }
      const raw = input.slice(start, position);
      tokens.push({
        kind: "word",
        value: raw.toLowerCase(),
        upper: raw.toUpperCase(),
        raw,
        range: { from: start, to: position },
      });
      pathEnd = position;
      continue;
    }

    const twoChars = input.slice(position, position + 2);
    if (twoChars === ">=" || twoChars === "<=" || twoChars === "<>") {
      tokens.push({
        kind: "operator",
        value: twoChars,
        range: { from: start, to: start + 2 },
      });
      position += 2;
      continue;
    }
    if (twoChars === "!=") {
      tokens.push({
        kind: "operator",
        value: "!=",
        range: { from: start, to: start + 2 },
      });
      position += 2;
      continue;
    }
    if (char === "=" || char === ">" || char === "<") {
      tokens.push({
        kind: "operator",
        value: char,
        range: { from: start, to: start + 1 },
      });
      position += 1;
      continue;
    }
    if (char === "(" || char === ")" || char === ",") {
      tokens.push({
        kind: "punctuation",
        value: char,
        range: { from: start, to: start + 1 },
      });
      position += 1;
      continue;
    }

    if (char === "*" && field === "projection") {
      return error(
        field,
        "unsupported-syntax",
        "Leave Project empty to return all columns.",
        start,
        start + 1,
      );
    }

    if ("+-*/%|".includes(char)) {
      return error(
        field,
        "unsupported-syntax",
        "Arithmetic and expressions are not supported.",
        start,
        start + 1,
      );
    }

    return error(
      field,
      "unexpected-character",
      `Unexpected "${char}".`,
      start,
      start + 1,
    );
  }

  return { ok: true, value: tokens };
}
