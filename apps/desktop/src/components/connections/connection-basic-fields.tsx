import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { ConnectionFields } from "@/shared/types/connection";
import { ConnectionEnvImport } from "./connection-env-import";
import type { ParsedEnvConnection } from "./parse-env-block";

interface ConnectionBasicFieldsProps {
  mode: "uri" | "fields";
  onModeChange: (mode: "uri" | "fields") => void;
  uri: string;
  onUriChange: (uri: string) => void;
  fields: ConnectionFields;
  onFieldsChange: (updater: (f: ConnectionFields) => ConnectionFields) => void;
  errors: Record<string, string>;
  onEnvExtract: (parsed: ParsedEnvConnection) => void;
}

export function ConnectionBasicFields({
  mode,
  onModeChange,
  uri,
  onUriChange,
  fields,
  onFieldsChange,
  errors,
  onEnvExtract,
}: Readonly<ConnectionBasicFieldsProps>) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>Connection Mode</Label>
          <ConnectionEnvImport onExtract={onEnvExtract} />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === "uri" ? "default" : "outline"}
            size="sm"
            onClick={() => onModeChange("uri")}
          >
            URI
          </Button>
          <Button
            type="button"
            variant={mode === "fields" ? "default" : "outline"}
            size="sm"
            onClick={() => onModeChange("fields")}
          >
            Individual Fields
          </Button>
        </div>
      </div>

      {mode === "uri" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="conn-uri">Connection URI</Label>
          <Input
            id="conn-uri"
            placeholder="postgresql://user:password@localhost:5432/mydb"
            className="font-mono text-sm"
            value={uri}
            onChange={(e) => onUriChange(e.target.value)}
          />
          {errors.uri && (
            <p className="text-xs text-destructive">{errors.uri}</p>
          )}
        </div>
      )}

      {mode === "fields" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="conn-host">Host</Label>
            <Input
              id="conn-host"
              placeholder="localhost"
              value={fields.host}
              onChange={(e) =>
                onFieldsChange((f) => ({ ...f, host: e.target.value }))
              }
            />
            {errors.host && (
              <p className="text-xs text-destructive">{errors.host}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-port">Port</Label>
            <Input
              id="conn-port"
              type="number"
              placeholder="5432"
              value={fields.port}
              onChange={(e) =>
                onFieldsChange((f) => ({
                  ...f,
                  port: Number.parseInt(e.target.value, 10) || 5432,
                }))
              }
            />
            {errors.port && (
              <p className="text-xs text-destructive">{errors.port}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-database">Database</Label>
            <Input
              id="conn-database"
              placeholder="postgres"
              value={fields.database}
              onChange={(e) =>
                onFieldsChange((f) => ({ ...f, database: e.target.value }))
              }
            />
            {errors.database && (
              <p className="text-xs text-destructive">{errors.database}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-user">User</Label>
            <Input
              id="conn-user"
              placeholder="postgres"
              value={fields.user}
              onChange={(e) =>
                onFieldsChange((f) => ({ ...f, user: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-password">Password</Label>
            <Input
              id="conn-password"
              type="password"
              value={fields.password}
              onChange={(e) =>
                onFieldsChange((f) => ({ ...f, password: e.target.value }))
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
