import { beforeEach, describe, expect, it, vi } from "vitest";

const { openExternal } = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
}));

vi.mock("electron", () => ({
  shell: { openExternal },
}));

import {
  buildContentSecurityPolicy,
  configureContentSecurityPolicy,
  configureWindowSecurity,
  isAllowedExternalUrl,
} from "@/main/window-security";

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.tile.openstreetmap.org",
  "font-src 'self' data:",
  "connect-src 'self' https://*.tile.openstreetmap.org",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
  "form-action 'none'",
].join("; ");

function configureFakeWindow() {
  let navigate:
    | ((event: { preventDefault: () => void }, url: string) => void)
    | undefined;
  let openWindow: ((details: { url: string }) => unknown) | undefined;
  let permission:
    | ((
        webContents: unknown,
        permission: string,
        callback: (allowed: boolean) => void,
      ) => void)
    | undefined;
  let permissionCheck: (() => boolean) | undefined;
  const window = {
    webContents: {
      setWindowOpenHandler: vi.fn((handler) => {
        openWindow = handler;
      }),
      on: vi.fn((event: string, callback) => {
        if (event === "will-navigate") navigate = callback;
      }),
      session: {
        setPermissionRequestHandler: vi.fn((callback) => {
          permission = callback;
        }),
        setPermissionCheckHandler: vi.fn((callback) => {
          permissionCheck = callback;
        }),
      },
    },
  };

  configureWindowSecurity(window as never);

  return {
    navigate: (url: string) => {
      const preventDefault = vi.fn();
      navigate!({ preventDefault }, url);
      return preventDefault;
    },
    openWindow: (url: string) => openWindow!({ url }),
    requestPermission: (name: string) => {
      const callback = vi.fn();
      permission!(undefined, name, callback);
      return callback;
    },
    checkPermission: () => permissionCheck!(),
  };
}

describe("Electron window security", () => {
  beforeEach(() => {
    openExternal.mockClear();
  });

  it("allows only known HTTPS external hosts", () => {
    expect(isAllowedExternalUrl("https://github.com/waterrmalann")).toBe(true);
    expect(isAllowedExternalUrl("https://www.openstreetmap.org/")).toBe(true);
    expect(isAllowedExternalUrl("http://github.com/waterrmalann")).toBe(false);
    expect(isAllowedExternalUrl("https://github.com.evil.example/")).toBe(
      false,
    );
    expect(isAllowedExternalUrl("not a url")).toBe(false);
  });

  it("installs CSP response headers", () => {
    let headersCallback:
      | ((
          details: { responseHeaders?: Record<string, string[]> },
          callback: (response: {
            responseHeaders: Record<string, string[]>;
          }) => void,
        ) => void)
      | undefined;
    const session = {
      webRequest: {
        onHeadersReceived: vi.fn((callback) => {
          headersCallback = callback;
        }),
      },
    };

    configureContentSecurityPolicy(session as never);

    const applyHeaders = vi.fn();
    headersCallback?.(
      { responseHeaders: { Existing: ["value"] } },
      applyHeaders,
    );
    expect(applyHeaders).toHaveBeenCalledWith({
      responseHeaders: {
        Existing: ["value"],
        "Content-Security-Policy": [PRODUCTION_CSP],
      },
    });
  });

  it("adds the dev-server websocket and inline scripts only in development", () => {
    expect(buildContentSecurityPolicy()).toBe(PRODUCTION_CSP);

    const developmentPolicy = buildContentSecurityPolicy(
      "http://localhost:5173",
    );
    expect(developmentPolicy).toContain("ws://localhost:5173");
    expect(developmentPolicy).not.toContain(" wss:");
    expect(developmentPolicy).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("denies in-app navigation and new windows but opens allowed links externally", async () => {
    const fakeWindow = configureFakeWindow();

    expect(fakeWindow.openWindow("https://github.com/waterrmalann")).toEqual({
      action: "deny",
    });
    const preventDefault = fakeWindow.navigate(
      "https://www.openstreetmap.org/?mlat=1&mlon=2",
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(2));
    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/waterrmalann",
    );
    expect(openExternal).toHaveBeenCalledWith(
      "https://www.openstreetmap.org/?mlat=1&mlon=2",
    );
  });

  it.each([
    "file:///C:/Windows/win.ini",
    "smb://attacker.example/share",
    "http://github.com/",
  ])("never hands %s to the OS from navigation or window.open", async (url) => {
    const fakeWindow = configureFakeWindow();

    expect(fakeWindow.openWindow(url)).toEqual({ action: "deny" });
    expect(fakeWindow.navigate(url)).toHaveBeenCalledOnce();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("denies every permission request and check", () => {
    const fakeWindow = configureFakeWindow();

    expect(fakeWindow.requestPermission("geolocation")).toHaveBeenCalledWith(
      false,
    );
    expect(fakeWindow.checkPermission()).toBe(false);
  });
});
