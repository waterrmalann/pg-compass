import { stringify } from "@/lib/utils";
import { typeRegistry, type TypeRenderer } from "./type-registry";
import { JSX } from "react";
import { parseEWKBHex, type ParsedGeometry } from "./postgis-parse";

function buildMapUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}&zoom=15`;
}

function toGeoJSON(geom: ParsedGeometry) {
  if (geom.type === "Point") {
    return {
      type: "Point",
      coordinates: geom.coordinates,
    };
  }
  return null;
}

function parseGeometry(value: unknown): ParsedGeometry | null {
  if (typeof value !== "string") return null;
  try {
    return parseEWKBHex(value);
  } catch {
    return null;
  }
}

const geographyRenderer: TypeRenderer = {
  renderCell(value: unknown) {
    const geom = parseGeometry(value);

    if (!geom) {
      return <span className="font-mono text-xs">{stringify(value)}</span>;
    }

    if (geom.type === "Point") {
      const { x, y } = geom.coordinates;

      return (
        <span className="font-mono text-xs">
          POINT({y.toFixed(4)}, {x.toFixed(4)})
        </span>
      );
    }

    return (
      <span className="font-mono text-xs text-muted-foreground">
        {geom.type}
      </span>
    );
  },

  renderCard(value: unknown) {
    const geom = parseGeometry(value);

    if (!geom) {
      return (
        <pre className="font-mono text-xs whitespace-pre-wrap break-all">
          {stringify(value)}
        </pre>
      );
    }

    const geojson = toGeoJSON(geom);

    let mapLink: JSX.Element | null = null;

    if (geom.type === "Point") {
      const { x, y } = geom.coordinates;
      const url = buildMapUrl(y, x);

      mapLink = (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          [open in map]
        </a>
      );
    }

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-subtle-foreground">
            {geom.type}
          </span>
          {mapLink}
        </div>

        <pre className="font-mono text-xs whitespace-pre-wrap break-all">
          {JSON.stringify(geojson, null, 2)}
        </pre>
      </div>
    );
  },
};

export function registerPostGISRenderers(): void {
  typeRegistry.registerMany(["geometry", "geography"], geographyRenderer);
}
