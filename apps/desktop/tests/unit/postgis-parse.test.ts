import { describe, expect, it } from "vitest";
import {
  extractPoint,
  parseEWKBHex,
  pointToEWKT,
} from "@/components/workspace/renderers/postgis-parse";

describe("parseEWKBHex", () => {
  it("parses a little-endian Point without SRID", () => {
    // EWKB: 01 (LE) | 01000000 (Point, type=1) | 8 bytes x=1.0 | 8 bytes y=2.0
    const hex =
      "0101000000" +
      "000000000000F03F" + // 1.0
      "0000000000000040"; // 2.0
    const geom = parseEWKBHex(hex);
    expect(geom).toEqual({
      type: "Point",
      coordinates: { x: 1, y: 2 },
      srid: undefined,
    });
  });

  it("parses a Point with SRID flag set", () => {
    // Type 0x20000001 = Point with SRID, LE. SRID = 4326 (0xE6100000 LE).
    const hex =
      "01" + "01000020" + "E6100000" + "000000000000F03F" + "0000000000000040";
    const geom = parseEWKBHex(hex);
    expect(geom).toMatchObject({
      type: "Point",
      coordinates: { x: 1, y: 2 },
      srid: 4326,
    });
  });

  it("returns Unknown for non-Point geometry types", () => {
    // geomType 2 (LineString) with no SRID
    const hex = "0102000000";
    const geom = parseEWKBHex(hex);
    expect(geom).toEqual({ type: "Unknown", srid: undefined });
  });

  it("returns Invalid for hex too short to hold a geometry header", () => {
    expect(parseEWKBHex("")).toEqual({ type: "Invalid" });
    expect(parseEWKBHex("01")).toEqual({ type: "Invalid" });
  });
});

describe("extractPoint", () => {
  it("returns null for non-string inputs", () => {
    expect(extractPoint(null)).toBeNull();
    expect(extractPoint(undefined)).toBeNull();
    expect(extractPoint(42)).toBeNull();
    expect(extractPoint({})).toBeNull();
  });

  it("parses WKT POINT without SRID, defaulting to 4326", () => {
    expect(extractPoint("POINT(-122.4 37.7)")).toEqual({
      lat: 37.7,
      lng: -122.4,
      srid: 4326,
    });
  });

  it("parses EWKT with explicit SRID", () => {
    expect(extractPoint("SRID=3857;POINT(10 20)")).toEqual({
      lat: 20,
      lng: 10,
      srid: 3857,
    });
  });

  it("accepts negative SRIDs (spec does not forbid them syntactically)", () => {
    expect(extractPoint("SRID=-1;POINT(0 0)")).toEqual({
      lat: 0,
      lng: 0,
      srid: -1,
    });
  });

  it("is case-insensitive for POINT keyword", () => {
    expect(extractPoint("srid=4326;point(1 2)")).toEqual({
      lat: 2,
      lng: 1,
      srid: 4326,
    });
  });

  it("returns null for malformed WKT", () => {
    expect(extractPoint("POINT(1)")).toBeNull();
    expect(extractPoint("POINT 1 2")).toBeNull();
    expect(extractPoint("LINESTRING(1 2, 3 4)")).toBeNull();
    expect(extractPoint("")).toBeNull();
    expect(extractPoint("   ")).toBeNull();
  });

  it("reads lat/lng/SRID from an EWKB hex Point", () => {
    // SRID 3857 (0x0F11, little-endian 110F0000), x=1, y=2.
    expect(
      extractPoint("0101000020110F0000000000000000F03F0000000000000040"),
    ).toEqual({ lat: 2, lng: 1, srid: 3857 });
  });

  it("returns null when EWKB hex parses to a non-Point geometry", () => {
    expect(extractPoint("0102000000")).toBeNull();
  });
});

describe("pointToEWKT", () => {
  it("formats to SRID=...;POINT(lng lat)", () => {
    expect(pointToEWKT({ lat: 37.7, lng: -122.4, srid: 4326 })).toBe(
      "SRID=4326;POINT(-122.4 37.7)",
    );
  });

  it("round-trips through extractPoint", () => {
    const p = { lat: 40.7, lng: -74, srid: 4326 };
    expect(extractPoint(pointToEWKT(p))).toEqual(p);
  });
});
