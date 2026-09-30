import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS } from "@/shared/types/settings";

const mocks = vi.hoisted(() => ({ locatePsql: vi.fn() }));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({ settings: DEFAULT_APP_SETTINGS }),
}));

import { usePsqlLocation } from "@/hooks/use-psql-location";

const found = { path: "/usr/bin/psql", source: "path", platform: "linux" };

describe("usePsqlLocation", () => {
  beforeEach(() => {
    mocks.locatePsql.mockReset();
    mocks.locatePsql.mockResolvedValue({ success: true, data: found });
    Object.defineProperty(window, "shellApi", {
      configurable: true,
      value: { locatePsql: mocks.locatePsql },
    });
  });

  it("shares one lookup between buttons mounted together", async () => {
    const first = renderHook(() => usePsqlLocation());
    const second = renderHook(() => usePsqlLocation());

    await waitFor(() => expect(first.result.current.location).toEqual(found));
    expect(second.result.current.location).toEqual(found);
    expect(mocks.locatePsql).toHaveBeenCalledTimes(1);
  });

  it("checks again when the window regains focus", async () => {
    const { result } = renderHook(() => usePsqlLocation());
    await waitFor(() => expect(result.current.location).toEqual(found));

    const missing = { path: null, source: null, platform: "linux" };
    mocks.locatePsql.mockResolvedValue({ success: true, data: missing });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(result.current.location).toEqual(missing));
  });

  it("stays unknown when the lookup fails", async () => {
    mocks.locatePsql.mockRejectedValue(new Error("ipc down"));
    const { result } = renderHook(() => usePsqlLocation());

    await waitFor(() => expect(mocks.locatePsql).toHaveBeenCalled());
    expect(result.current.location).toBeNull();
  });
});
