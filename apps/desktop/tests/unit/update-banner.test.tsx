import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "@/components/updates/update-banner";
import type { UpdateStatus } from "@/shared/types/updates";

let emitStatus: (status: UpdateStatus) => void = () => {};
const install = vi.fn();

function mockUpdateApi(initialStatus: UpdateStatus) {
  Object.defineProperty(globalThis.window, "updateApi", {
    configurable: true,
    value: {
      getStatus: vi
        .fn()
        .mockResolvedValue({ success: true, data: initialStatus }),
      install,
      onStatusChanged: (callback: (status: UpdateStatus) => void) => {
        emitStatus = callback;
        return () => {};
      },
    },
  });
}

describe("UpdateBanner", () => {
  beforeEach(() => {
    install.mockReset();
  });

  it("stays hidden while the app is up to date", async () => {
    mockUpdateApi({ kind: "up-to-date" });
    const { container } = render(<UpdateBanner />);

    await act(async () => {});

    expect(container).toBeEmptyDOMElement();
  });

  it("links to the release when a new version is available", async () => {
    mockUpdateApi({
      kind: "available",
      version: "1.3.0",
      releaseUrl:
        "https://github.com/waterrmalann/pg-compass/releases/tag/v1.3.0",
    });
    render(<UpdateBanner />);

    expect(
      await screen.findByText("PG Compass 1.3.0 is available."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
      "href",
      "https://github.com/waterrmalann/pg-compass/releases/tag/v1.3.0",
    );
  });

  it("stays dismissed for the same message but shows a downloaded update", async () => {
    const user = userEvent.setup();
    mockUpdateApi({
      kind: "available",
      version: "1.3.0",
      releaseUrl:
        "https://github.com/waterrmalann/pg-compass/releases/tag/v1.3.0",
    });
    render(<UpdateBanner />);

    await user.click(
      await screen.findByRole("button", { name: "Dismiss update notice" }),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() =>
      emitStatus({
        kind: "available",
        version: "1.3.0",
        releaseUrl:
          "https://github.com/waterrmalann/pg-compass/releases/tag/v1.3.0",
      }),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => emitStatus({ kind: "ready", version: "1.3.0" }));
    expect(
      screen.getByText("PG Compass 1.3.0 is ready to install."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(install).toHaveBeenCalled();
  });
});
