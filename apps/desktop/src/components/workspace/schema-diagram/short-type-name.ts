/**
 * SQL-standard spellings that `format_type` returns, mapped to the shorter
 * PostgreSQL aliases developers type, so column types fit on a card.
 */
const SHORT_TYPE_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["timestamp with time zone", "timestamptz"],
  ["timestamp without time zone", "timestamp"],
  ["time with time zone", "timetz"],
  ["time without time zone", "time"],
  ["character varying", "varchar"],
  ["bit varying", "varbit"],
  ["double precision", "float8"],
  ["character", "char"],
];

/**
 * `timestamp(3) with time zone[]` → `timestamptz(3)[]`. Precision and array
 * suffixes are kept; anything else is returned unchanged.
 */
export function shortTypeName(dataType: string): string {
  // `timestamp(3) with time zone`: format_type puts precision mid-name.
  const precisionInside =
    /^(timestamp|time)(\(\d+\)) (with(?:out)? time zone)(.*)$/;
  const match = precisionInside.exec(dataType);
  if (match) {
    const [, base, precision, zone, rest] = match;
    return `${shortTypeName(`${base} ${zone}`)}${precision}${rest}`;
  }

  for (const [longName, shortName] of SHORT_TYPE_NAMES) {
    if (dataType === longName) return shortName;
    const followedBySuffix =
      dataType.startsWith(longName) &&
      /^[([]/.test(dataType.slice(longName.length));
    if (followedBySuffix) return shortName + dataType.slice(longName.length);
  }
  return dataType;
}
