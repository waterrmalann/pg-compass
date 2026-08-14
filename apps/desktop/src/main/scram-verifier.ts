import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const SCRAM_ITERATIONS = 4096;
const SCRAM_SALT_BYTES = 16;
const SCRAM_KEY_BYTES = 32;

// RFC 4013 tables used by SASLprep (as in PostgreSQL's pg_saslprep), as
// inclusive [first, last] code point ranges.
type CodePointRange = readonly [number, number];

const NON_ASCII_SPACE_RANGES: CodePointRange[] = [
  [0x00a0, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200b],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

const MAPPED_TO_NOTHING_RANGES: CodePointRange[] = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x1806, 0x1806],
  [0x180b, 0x180d],
  [0x200b, 0x200d],
  [0x2060, 0x2060],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
];

const PROHIBITED_OUTPUT_RANGES: CodePointRange[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x0340, 0x0341],
  [0x06dd, 0x06dd],
  [0x070f, 0x070f],
  [0x180e, 0x180e],
  [0x200c, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2063],
  [0x206a, 0x206f],
  [0x2ff0, 0x2ffb],
  [0xd800, 0xdfff],
  [0xe000, 0xf8ff],
  [0xfdd0, 0xfdef],
  [0xfeff, 0xfeff],
  [0xfff9, 0xffff],
  [0x1d173, 0x1d17a],
  [0xe0001, 0xe0001],
  [0xe0020, 0xe007f],
  [0xf0000, 0x10ffff],
];

const UNASSIGNED_PATTERN = /\p{Cn}/u;
const PRINTABLE_ASCII_PATTERN = /^[ -~]*$/;

function isInRanges(codePoint: number, ranges: CodePointRange[]): boolean {
  return ranges.some(
    ([first, last]) => codePoint >= first && codePoint <= last,
  );
}

/**
 * Normalize a password the way libpq and the server do before hashing, so a
 * verifier computed here matches what `psql` sends at login. SASLprep is the
 * identity for printable ASCII. When the prepared string contains prohibited
 * characters, PostgreSQL falls back to the raw password, and so do we. The
 * bidirectional-text check is not implemented; such passwords are rare.
 */
function saslprep(password: string): string {
  if (PRINTABLE_ASCII_PATTERN.test(password)) return password;

  let mapped = "";
  for (const char of password) {
    const codePoint = char.codePointAt(0)!;
    if (isInRanges(codePoint, NON_ASCII_SPACE_RANGES)) {
      mapped += " ";
      continue;
    }
    if (isInRanges(codePoint, MAPPED_TO_NOTHING_RANGES)) continue;
    mapped += char;
  }

  const normalized = mapped.normalize("NFKC");
  for (const char of normalized) {
    const codePoint = char.codePointAt(0)!;
    const isProhibited =
      isInRanges(codePoint, PROHIBITED_OUTPUT_RANGES) ||
      UNASSIGNED_PATTERN.test(char);
    if (isProhibited) return password;
  }
  return normalized;
}

/**
 * Compute a PostgreSQL SCRAM-SHA-256 password verifier, the same value the
 * server stores in `pg_authid.rolpassword`. Passing the verifier (never the
 * plaintext) to CREATE/ALTER ROLE keeps the password out of server logs,
 * `pg_stat_activity` and statement history.
 */
export function buildScramSha256Verifier(
  password: string,
  salt: Buffer = randomBytes(SCRAM_SALT_BYTES),
): string {
  const preparedPassword = saslprep(password);
  const saltedPassword = pbkdf2Sync(
    Buffer.from(preparedPassword, "utf8"),
    salt,
    SCRAM_ITERATIONS,
    SCRAM_KEY_BYTES,
    "sha256",
  );
  const clientKey = createHmac("sha256", saltedPassword)
    .update("Client Key")
    .digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", saltedPassword)
    .update("Server Key")
    .digest();

  const saltBase64 = salt.toString("base64");
  const storedKeyBase64 = storedKey.toString("base64");
  const serverKeyBase64 = serverKey.toString("base64");
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${saltBase64}$${storedKeyBase64}:${serverKeyBase64}`;
}
