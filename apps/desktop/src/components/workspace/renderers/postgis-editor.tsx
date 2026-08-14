/**
 * PostGIS map editor. Phase 1 scope:
 *
 *   - Point geometries get full treatment: map click-to-place, lat/lng/SRID
 *     inputs, and an auto-composed WKT preview — all three stay in sync.
 *   - Other geometries (LineString, Polygon, …) are edited through the
 *     WKT/EWKT textarea. The map shows no marker in that case.
 *
 * The textarea is authoritative: whatever text it contains at save time is
 * what we send. The structured form is a convenience layer — editing it
 * rewrites the textarea, but editing the textarea does not round-trip back
 * into the form (we don't want to reparse arbitrary WKT on every keystroke).
 */

import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  MapContainer,
  TileLayer,
  Marker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import icon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogFooter } from "@/components/ui/dialog";
import {
  editRegistry,
  type EditResult,
  type TypeEditor,
  type TypeEditorProps,
} from "@/components/workspace/renderers/edit-registry";
import {
  extractPoint,
  pointToEWKT,
} from "@/components/workspace/renderers/postgis-parse";

// Leaflet's default marker icon URLs resolve through the bundler's image
// loader; without these overrides Leaflet emits requests to the wrong path.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl,
  shadowUrl,
  iconRetinaUrl: icon2xUrl,
});

function ClickCapture({
  onSelect,
}: Readonly<{ onSelect: (lat: number, lng: number) => void }>) {
  useMapEvents({
    click(event) {
      onSelect(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

// Pans to a new marker position without remounting the map. `MapContainer`'s
// `center`/`zoom` props only apply at mount, so re-centering on every
// lat/lng edit via a coordinate-derived `key` would fully tear down and
// recreate the Leaflet map (tile refetch, lost pan/zoom) on every keystroke.
function RecenterOnMarkerChange({
  position,
}: Readonly<{ position: [number, number] | null }>) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, map.getZoom());
  }, [position, map]);
  return null;
}

function initialWkt(
  value: unknown,
  parsed: ReturnType<typeof extractPoint>,
): string {
  if (parsed) return pointToEWKT(parsed);
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Hex EWKB blobs aren't human-editable; let the user start fresh.
    if (/^[0-9a-f]+$/i.test(trimmed)) return "";
    return trimmed;
  }
  return "";
}

export function GeometryMapEditor({
  initialValue,
  onSave,
  onCancel,
}: Readonly<TypeEditorProps>) {
  const parsed = useMemo(() => extractPoint(initialValue), [initialValue]);
  const [lat, setLat] = useState<string>(parsed ? String(parsed.lat) : "");
  const [lng, setLng] = useState<string>(parsed ? String(parsed.lng) : "");
  const [srid, setSrid] = useState<string>(
    parsed ? String(parsed.srid) : "4326",
  );
  const [wkt, setWkt] = useState<string>(() =>
    initialWkt(initialValue, parsed),
  );
  const [pointMode, setPointMode] = useState<boolean>(parsed !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    function syncPointToWkt() {
      if (!pointMode) return;
      const latN = Number.parseFloat(lat);
      const lngN = Number.parseFloat(lng);
      const sridN = Number.parseInt(srid, 10);
      if (
        Number.isFinite(latN) &&
        Number.isFinite(lngN) &&
        Number.isFinite(sridN)
      ) {
        setWkt(pointToEWKT({ lat: latN, lng: lngN, srid: sridN }));
      }
    },
    [lat, lng, srid, pointMode],
  );

  const markerPosition = useMemo<[number, number] | null>(() => {
    const latN = Number.parseFloat(lat);
    const lngN = Number.parseFloat(lng);
    if (pointMode && Number.isFinite(latN) && Number.isFinite(lngN)) {
      return [latN, lngN];
    }
    return null;
  }, [lat, lng, pointMode]);

  const mapCenter: [number, number] = markerPosition ?? [20, 0];
  const mapZoom = markerPosition ? 6 : 2;

  function handleMapClick(nextLat: number, nextLng: number): void {
    setPointMode(true);
    setLat(nextLat.toFixed(6));
    setLng(nextLng.toFixed(6));
  }

  function handlePointFieldChange(
    setter: (next: string) => void,
    next: string,
  ): void {
    setPointMode(true);
    setter(next);
  }

  function handleWktChange(next: string): void {
    // Editing the textarea takes authority away from the structured form —
    // further point-mode edits would otherwise clobber what the user typed.
    setPointMode(false);
    setWkt(next);
  }

  function handleSave(): void {
    const value = wkt.trim();
    if (value === "") {
      setError("Geometry cannot be empty.");
      return;
    }
    const result: EditResult = { value, pgCast: "geometry" };
    onSave(result);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="postgis-editor">
      <div
        className="h-64 overflow-hidden rounded-md border border-border"
        data-testid="postgis-map-wrapper"
      >
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          <ClickCapture onSelect={handleMapClick} />
          <RecenterOnMarkerChange position={markerPosition} />
          {markerPosition ? <Marker position={markerPosition} /> : null}
        </MapContainer>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1" htmlFor="postgis-longitude">
          <span className="text-[10px] text-muted-foreground">Longitude</span>
          <Input
            id="postgis-longitude"
            value={lng}
            onChange={(e) => handlePointFieldChange(setLng, e.target.value)}
            className="font-mono text-xs"
            data-testid="postgis-lng"
          />
        </label>
        <label className="flex flex-col gap-1" htmlFor="postgis-latitude">
          <span className="text-[10px] text-muted-foreground">Latitude</span>
          <Input
            id="postgis-latitude"
            value={lat}
            onChange={(e) => handlePointFieldChange(setLat, e.target.value)}
            className="font-mono text-xs"
            data-testid="postgis-lat"
          />
        </label>
        <label className="flex flex-col gap-1" htmlFor="postgis-srid">
          <span className="text-[10px] text-muted-foreground">SRID</span>
          <Input
            id="postgis-srid"
            value={srid}
            onChange={(e) => handlePointFieldChange(setSrid, e.target.value)}
            className="font-mono text-xs"
            data-testid="postgis-srid"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-muted-foreground">WKT / EWKT</span>
        <textarea
          value={wkt}
          onChange={(e) => handleWktChange(e.target.value)}
          placeholder="SRID=4326;POINT(-122.419 37.775)"
          spellCheck={false}
          data-testid="postgis-wkt"
          className="min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </label>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleSave}>
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * Swap the `geometry`/`geography` registrations installed by
 * `registerDefaultEditors()` with variants that carry the map Component. Must
 * be called AFTER `registerDefaultEditors()`.
 */
export function registerPostGISEditor(): void {
  for (const pgType of ["geometry", "geography"] as const) {
    const current = editRegistry.get(pgType);
    const withComponent: TypeEditor = {
      ...current,
      kind: "modal",
      Component: GeometryMapEditor,
    };
    editRegistry.register(pgType, withComponent);
  }
}
