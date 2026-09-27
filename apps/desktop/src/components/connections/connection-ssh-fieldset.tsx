import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FileSearch } from "lucide-react";
import type { SSHConfig } from "@/shared/types/connection";

interface ConnectionSSHFieldsetProps {
  value: SSHConfig;
  onChange: (updater: (s: SSHConfig) => SSHConfig) => void;
}

export function ConnectionSSHFieldset({
  value,
  onChange,
}: Readonly<ConnectionSSHFieldsetProps>) {
  async function handleBrowsePrivateKey() {
    const result = await globalThis.window.connectionApi.showOpenFileDialog({
      title: "Select SSH private key",
      defaultPath: value.privateKeyPath || undefined,
      filters: [
        { name: "Private key files", extensions: ["pem", "key", "rsa"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.success && result.data) {
      onChange((s) => ({ ...s, privateKeyPath: result.data ?? "" }));
    }
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
      <Label
        htmlFor="ssh-enabled"
        className="flex min-h-6 cursor-pointer items-center gap-2"
      >
        <input
          id="ssh-enabled"
          type="checkbox"
          checked={value.enabled}
          onChange={(e) =>
            onChange((s) => ({ ...s, enabled: e.target.checked }))
          }
        />
        <span>Enable SSH tunnel</span>
      </Label>
      {value.enabled && (
        <div className="grid grid-cols-2 gap-3 pl-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssh-host">SSH host</Label>
            <Input
              id="ssh-host"
              value={value.host}
              onChange={(e) =>
                onChange((s) => ({ ...s, host: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssh-port">SSH port</Label>
            <Input
              id="ssh-port"
              type="number"
              value={value.port}
              onChange={(e) =>
                onChange((s) => ({
                  ...s,
                  port: Number.parseInt(e.target.value, 10) || 22,
                }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssh-user">SSH user</Label>
            <Input
              id="ssh-user"
              value={value.user}
              onChange={(e) =>
                onChange((s) => ({ ...s, user: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] leading-none font-medium">
              Auth method
            </span>
            <SegmentedControl
              ariaLabel="SSH auth method"
              className="w-full"
              value={value.authMethod}
              onValueChange={(authMethod) =>
                onChange((s) => ({ ...s, authMethod }))
              }
              options={[
                { value: "password", label: "Password" },
                { value: "privateKey", label: "Key" },
              ]}
            />
          </div>
          {value.authMethod === "password" && (
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="ssh-password">SSH password</Label>
              <Input
                id="ssh-password"
                type="password"
                value={value.password ?? ""}
                onChange={(e) =>
                  onChange((s) => ({ ...s, password: e.target.value }))
                }
              />
            </div>
          )}
          {value.authMethod === "privateKey" && (
            <>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="ssh-key">Private key file</Label>
                <div className="flex gap-2">
                  <Input
                    id="ssh-key"
                    className="font-mono text-xs"
                    placeholder="Select a private key file"
                    value={value.privateKeyPath ?? ""}
                    onChange={(e) =>
                      onChange((s) => ({
                        ...s,
                        privateKeyPath: e.target.value,
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBrowsePrivateKey}
                  >
                    <FileSearch />
                    Browse
                  </Button>
                </div>
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="ssh-passphrase">Passphrase</Label>
                <Input
                  id="ssh-passphrase"
                  type="password"
                  value={value.passphrase ?? ""}
                  onChange={(e) =>
                    onChange((s) => ({ ...s, passphrase: e.target.value }))
                  }
                />
              </div>
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}
