import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
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
  const [showUri, setShowUri] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] leading-none font-medium">Connection</span>
        <div className="flex items-center gap-2">
          <ConnectionEnvImport onExtract={onEnvExtract} />
          <SegmentedControl
            ariaLabel="Connection mode"
            value={mode}
            onValueChange={onModeChange}
            options={[
              { value: "uri", label: "URI" },
              { value: "fields", label: "Individual fields" },
            ]}
          />
        </div>
      </div>

      {mode === "uri" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="conn-uri">Connection URI</Label>
          <div className="relative">
            <Input
              id="conn-uri"
              type={showUri ? "text" : "password"}
              aria-invalid={errors.uri ? true : undefined}
              placeholder="postgresql://user:password@localhost:5432/mydb"
              className="pr-8 font-mono text-xs"
              value={uri}
              onChange={(e) => onUriChange(e.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setShowUri((value) => !value)}
              className="absolute top-1/2 right-1 -translate-y-1/2"
              aria-label={
                showUri ? "Hide connection URI" : "Show connection URI"
              }
            >
              {showUri ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          {errors.uri && (
            <p className="text-xs text-destructive-foreground">{errors.uri}</p>
          )}
        </div>
      )}

      {mode === "fields" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="conn-host">Host</Label>
            <Input
              id="conn-host"
              aria-invalid={errors.host ? true : undefined}
              placeholder="localhost"
              value={fields.host}
              onChange={(e) =>
                onFieldsChange((f) => ({ ...f, host: e.target.value }))
              }
            />
            {errors.host && (
              <p className="text-xs text-destructive-foreground">
                {errors.host}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-port">Port</Label>
            <Input
              id="conn-port"
              aria-invalid={errors.port ? true : undefined}
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
              <p className="text-xs text-destructive-foreground">
                {errors.port}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-database">Database</Label>
            <Input
              id="conn-database"
              aria-invalid={errors.database ? true : undefined}
              placeholder="postgres"
              value={fields.database}
              onChange={(e) =>
                onFieldsChange((f) => ({ ...f, database: e.target.value }))
              }
            />
            {errors.database && (
              <p className="text-xs text-destructive-foreground">
                {errors.database}
              </p>
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
