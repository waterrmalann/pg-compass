import { useState, useEffect, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnections } from "@/hooks/use-connections";
import { useWorkspace } from "@/hooks/use-workspace";
import { ConnectionColorPicker } from "./connection-color-picker";
import { ConnectionBasicFields } from "./connection-basic-fields";
import { ConnectionSSLFieldset } from "./connection-ssl-fieldset";
import { ConnectionSSHFieldset } from "./connection-ssh-fieldset";
import type { ParsedEnvConnection } from "./parse-env-block";
import type {
  ConnectionConfig,
  ConnectionInput,
  ConnectionFields,
  SSLConfig,
  SSHConfig,
} from "@/shared/types/connection";

interface ConnectionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass a connection to edit; leave undefined for create mode. */
  editConnection?: ConnectionConfig;
}

const defaultFields: ConnectionFields = {
  host: "localhost",
  port: 5432,
  database: "",
  user: "postgres",
  password: "",
};

const defaultSSL: SSLConfig = {
  enabled: false,
  rejectUnauthorized: true,
  caSource: "file",
  ca: "",
  cert: "",
  key: "",
};

const defaultSSH: SSHConfig = {
  enabled: false,
  host: "",
  port: 22,
  user: "",
  authMethod: "password",
  password: "",
  privateKeyPath: "",
  passphrase: "",
};

const POSTGRES_URL_RE = /^postgres(?:ql)?:\/\//i;

/**
 * Attempt to parse a full PostgreSQL connection URL into individual fields.
 * Returns the parsed fields on success, or null if the value is not a recognisable URL.
 */
export function tryParsePostgresUrl(value: string): ConnectionFields | null {
  if (!POSTGRES_URL_RE.test(value)) return null;
  try {
    const parsed = new URL(value);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 5432,
      database: parsed.pathname.replace(/^\//, ""),
      user: parsed.username ? decodeURIComponent(parsed.username) : "postgres",
      password: parsed.password ? decodeURIComponent(parsed.password) : "",
    };
  } catch {
    return null;
  }
}

/** Validate connection form inputs. Returns a map of field → error message. */
export function validateConnectionInput(
  mode: "uri" | "fields",
  uri: string,
  fields: ConnectionFields,
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (mode === "uri") {
    if (!uri.trim()) {
      errors.uri = "Connection URI is required.";
    } else if (!POSTGRES_URL_RE.test(uri.trim())) {
      errors.uri = "URI must start with postgres:// or postgresql://";
    }
  } else {
    if (!fields.host.trim()) {
      errors.host = "Host is required.";
    }
    if (!fields.database.trim()) {
      errors.database = "Database name is required.";
    }
    if (
      !Number.isInteger(fields.port) ||
      fields.port < 1 ||
      fields.port > 65535
    ) {
      errors.port = "Port must be a number between 1 and 65535.";
    }
  }

  return errors;
}

export function ConnectionFormDialog({
  open,
  onOpenChange,
  editConnection,
}: Readonly<ConnectionFormDialogProps>) {
  const { create, update } = useConnections();
  const { refreshTabs } = useWorkspace();
  const isEdit = !!editConnection;

  const [label, setLabel] = useState("");
  const [color, setColor] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<"uri" | "fields">("uri");
  const [uri, setUri] = useState("");
  const [fields, setFields] = useState<ConnectionFields>({ ...defaultFields });
  const [ssl, setSsl] = useState<SSLConfig>({ ...defaultSSL });
  const [ssh, setSsh] = useState<SSHConfig>({ ...defaultSSH });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;

    if (editConnection) {
      setLabel(editConnection.label);
      setColor(editConnection.color);
      setMode(editConnection.mode);
      setUri(editConnection.uri ?? "");
      setFields(editConnection.fields ?? { ...defaultFields });
      setSsl(editConnection.ssl ?? { ...defaultSSL });
      setSsh(editConnection.ssh ?? { ...defaultSSH });
      setAdvancedOpen(
        !!(editConnection.ssl?.enabled || editConnection.ssh?.enabled),
      );
    } else {
      setLabel("");
      setColor(undefined);
      setMode("uri");
      setUri("");
      setFields({ ...defaultFields });
      setSsl({ ...defaultSSL });
      setSsh({ ...defaultSSH });
      setAdvancedOpen(false);
    }
  }, [open, editConnection]);

  function handleModeChange(next: "uri" | "fields") {
    setMode(next);
    setErrors({});
  }

  function handleEnvExtract(parsed: ParsedEnvConnection) {
    if (parsed.uri) {
      setMode("uri");
      setUri(parsed.uri);
    } else if (Object.keys(parsed.fields).length > 0) {
      setMode("fields");
      setFields((f) => ({ ...f, ...parsed.fields }));
    }

    if (parsed.ca) {
      setSsl((s) => ({ ...s, enabled: true, caSource: "inline", ca: parsed.ca }));
      setAdvancedOpen(true);
    }

    setErrors({});
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    // Users sometimes paste a full postgres:// URL into the host field; expand
    // it so validation sees real host/port/database values.
    let resolvedFields = fields;
    if (mode === "fields") {
      const parsed = tryParsePostgresUrl(fields.host);
      if (parsed) resolvedFields = { ...fields, ...parsed };
    }

    const errs = validateConnectionInput(mode, uri, resolvedFields);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSaving(true);

    const input: ConnectionInput = {
      label: label.trim() || "Untitled Connection",
      color: color || undefined,
      favourite: editConnection?.favourite ?? false,
      mode,
      uri: mode === "uri" ? uri : undefined,
      fields: mode === "fields" ? resolvedFields : undefined,
      ssl: ssl.enabled ? ssl : undefined,
      ssh: ssh.enabled ? ssh : undefined,
    };

    if (isEdit && editConnection) {
      const result = await update(editConnection.id, input);
      if (result && input.label !== editConnection.label) {
        refreshTabs(editConnection.id, { connectionLabel: input.label });
      }
    } else {
      await create(input);
    }

    setSaving(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Connection" : "New Connection"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the connection details below."
              : "Enter the details for your PostgreSQL connection."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-label">Label</Label>
            <Input
              id="conn-label"
              placeholder="My Database"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <ConnectionColorPicker value={color} onChange={setColor} />

          <ConnectionBasicFields
            mode={mode}
            onModeChange={handleModeChange}
            uri={uri}
            onUriChange={setUri}
            fields={fields}
            onFieldsChange={setFields}
            errors={errors}
            onEnvExtract={handleEnvExtract}
          />

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-between"
              >
                <span>Advanced Configuration</span>
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform duration-200",
                    advancedOpen && "rotate-180",
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-4 pt-3">
              <ConnectionSSLFieldset value={ssl} onChange={setSsl} />
              <ConnectionSSHFieldset value={ssh} onChange={setSsh} />
            </CollapsibleContent>
          </Collapsible>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isEdit ? "Save Changes" : "Create Connection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
