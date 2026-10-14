import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionSSHFieldset } from "@/components/connections/connection-ssh-fieldset";
import { ConnectionSSLFieldset } from "@/components/connections/connection-ssl-fieldset";
import type { SSHConfig, SSLConfig } from "@/shared/types/connection";

function SslHarness() {
  const [ssl, setSsl] = useState<SSLConfig>({
    enabled: true,
    rejectUnauthorized: true,
    caSource: "file",
    ca: "",
    cert: "",
    key: "",
  });

  return <ConnectionSSLFieldset value={ssl} onChange={setSsl} />;
}

function SshHarness() {
  const [ssh, setSsh] = useState<SSHConfig>({
    enabled: true,
    host: "",
    port: 22,
    user: "",
    authMethod: "privateKey",
    privateKeyPath: "",
  });

  return <ConnectionSSHFieldset value={ssh} onChange={setSsh} />;
}

describe("connection file fields", () => {
  beforeEach(() => {
    Object.assign(window, {
      connectionApi: {
        showOpenFileDialog: vi.fn().mockResolvedValue({
          success: true,
          data: "C:\\certs\\selected.pem",
        }),
      },
    });
  });

  it("fills SSL certificate paths from the file picker", async () => {
    const user = userEvent.setup();
    render(<SslHarness />);

    await user.click(screen.getAllByRole("button", { name: /browse/i })[0]!);

    expect(window.connectionApi.showOpenFileDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Select CA certificate" }),
    );
    expect(screen.getByLabelText("CA certificate")).toHaveValue(
      "C:\\certs\\selected.pem",
    );
  });

  it("preserves CA drafts when switching between file and inline sources", async () => {
    const user = userEvent.setup();
    render(<SslHarness />);

    await user.click(screen.getAllByRole("button", { name: /browse/i })[0]!);
    expect(screen.getByLabelText("CA certificate")).toHaveValue(
      "C:\\certs\\selected.pem",
    );

    await user.click(screen.getByRole("button", { name: "Inline" }));
    await user.type(screen.getByLabelText("CA certificate"), "INLINE_CA");

    await user.click(screen.getByRole("button", { name: "File" }));
    expect(screen.getByLabelText("CA certificate")).toHaveValue(
      "C:\\certs\\selected.pem",
    );

    await user.click(screen.getByRole("button", { name: "Inline" }));
    expect(screen.getByLabelText("CA certificate")).toHaveValue("INLINE_CA");
  });

  it("does not submit a surrounding form when changing SSL CA controls", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn();

    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <SslHarness />
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Inline" }));
    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(screen.getAllByRole("button", { name: /browse/i })[0]!);

    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it("fills SSH private key paths from the file picker", async () => {
    const user = userEvent.setup();
    render(<SshHarness />);

    await user.click(screen.getByRole("button", { name: /browse/i }));

    expect(window.connectionApi.showOpenFileDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Select SSH private key" }),
    );
    expect(screen.getByLabelText("Private key file")).toHaveValue(
      "C:\\certs\\selected.pem",
    );
  });
});
