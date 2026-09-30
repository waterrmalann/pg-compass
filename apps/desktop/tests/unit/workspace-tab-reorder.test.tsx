import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "@/components/workspace/workspace";
import type { WorkspaceTab } from "@/shared/types/workspace";

const setActiveTab = vi.fn();
const moveTab = vi.fn();

function usersTab(connectionId: string, label: string): WorkspaceTab {
  return {
    id: `${connectionId}:users`,
    title: `${label} · Users`,
    view: { type: "users", path: { connectionId, connectionLabel: label } },
  };
}

const tabs: WorkspaceTab[] = [
  usersTab("a", "Alpha"),
  usersTab("b", "Beta"),
  usersTab("c", "Gamma"),
];

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    tabs,
    activeTabId: "a:users",
    setActiveTab,
    closeTab: vi.fn(),
    closeAllTabs: vi.fn(),
    moveTab,
  }),
}));
vi.mock("@/hooks/use-connections", () => ({
  useConnections: () => ({ connections: [] }),
}));
vi.mock("@/hooks/use-density", () => ({ useDensity: () => "compact" }));
vi.mock("@/hooks/use-workspace-shortcuts", () => ({
  useWorkspaceShortcuts: () => undefined,
}));
vi.mock("@/components/workspace/users-viewer", () => ({
  UsersViewer: () => null,
}));

// jsdom has no PointerEvent, so fireEvent would drop `button` and `clientX`.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

const TAB_WIDTH = 176;
const TAB_STEP = 180;

function getTab(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tab-id="${id}"]`);
  if (!element) throw new Error(`Missing tab ${id}`);
  return element;
}

/** jsdom has no layout, so give each tab a fixed slot in the strip. */
function renderWithLayout() {
  render(<Workspace />);
  tabs.forEach((tab, index) => {
    const element = getTab(tab.id);
    Object.defineProperty(element, "offsetLeft", {
      configurable: true,
      get: () => index * TAB_STEP,
    });
    Object.defineProperty(element, "offsetWidth", {
      configurable: true,
      get: () => TAB_WIDTH,
    });
  });
  return {
    alpha: getTab("a:users"),
    beta: getTab("b:users"),
    gamma: getTab("c:users"),
  };
}

function press(element: HTMLElement, clientX: number) {
  const button = element.querySelector("button");
  if (!button) throw new Error("Missing tab button");
  fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX });
}

function moveTo(clientX: number) {
  fireEvent.pointerMove(globalThis.window, { pointerId: 1, clientX });
}

function release(clientX: number) {
  fireEvent.pointerUp(globalThis.window, { pointerId: 1, clientX });
}

describe("workspace tab reordering", () => {
  beforeEach(() => {
    setActiveTab.mockClear();
    moveTab.mockClear();
  });

  it("drags a tab past its neighbours and drops it in the new slot", () => {
    const { alpha, beta, gamma } = renderWithLayout();

    press(alpha, 20);
    moveTo(120);
    expect(alpha).toHaveAttribute("data-dragging", "true");
    expect(setActiveTab).toHaveBeenCalledWith("a:users");
    // Covering half of Beta slides it into Alpha's old slot.
    expect(beta.style.transform).toBe(`translateX(${-TAB_WIDTH}px)`);
    expect(gamma.style.transform).toBe("");

    // Far past the end, the tab is held at the last slot.
    moveTo(900);
    expect(alpha.style.transform).toBe(`translateX(${2 * TAB_STEP}px)`);
    expect(gamma.style.transform).toBe(`translateX(${-TAB_WIDTH}px)`);

    release(900);
    expect(moveTab).toHaveBeenCalledWith("a:users", 2);
    expect(beta.style.transform).toBe("");
    expect(gamma.style.transform).toBe("");
  });

  it("drops the tab back where it started when Escape is pressed", () => {
    const { alpha } = renderWithLayout();

    press(alpha, 20);
    moveTo(300);
    fireEvent.keyDown(globalThis.window, { key: "Escape" });
    release(300);

    expect(moveTab).not.toHaveBeenCalled();
  });

  it("treats a press that barely moves as a click", async () => {
    const user = userEvent.setup();
    renderWithLayout();

    await user.click(screen.getByRole("button", { name: "Gamma · Users" }));

    expect(moveTab).not.toHaveBeenCalled();
    expect(setActiveTab).toHaveBeenCalledWith("c:users");
  });

  it("moves a tab from its context menu", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    const alphaButton = screen.getByRole("button", { name: "Alpha · Users" });

    fireEvent.contextMenu(alphaButton);
    const moveLeft = await screen.findByRole("menuitem", { name: "Move left" });
    expect(moveLeft).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "Move right" }));

    expect(moveTab).toHaveBeenCalledWith("a:users", 1);
  });
});
