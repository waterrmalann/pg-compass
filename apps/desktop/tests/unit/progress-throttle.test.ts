import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgressThrottle } from "@/main/table-data-export";

function createSender(options: { destroyed?: boolean } = {}) {
  const send = vi.fn();
  const sender = {
    send,
    isDestroyed: () => options.destroyed ?? false,
  } as unknown as WebContents;
  return { sender, send };
}

describe("createProgressThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the first update at once and the newest count when the wait ends", () => {
    const { sender, send } = createSender();
    const progress = createProgressThrottle(sender, 200, "progress");

    progress.send(100);
    progress.send(200);
    progress.send(300);
    expect(send.mock.calls).toEqual([["progress", 100]]);

    vi.advanceTimersByTime(200);
    // Regression: the trailing send used to report 200, the count that
    // started the wait, not the newest one.
    expect(send.mock.calls).toEqual([
      ["progress", 100],
      ["progress", 300],
    ]);
  });

  it("flush sends the final count and drops the pending update", () => {
    const { sender, send } = createSender();
    const progress = createProgressThrottle(sender, 200, "progress");

    progress.send(1);
    progress.send(2);
    progress.flush(5);
    vi.advanceTimersByTime(1_000);

    expect(send.mock.calls).toEqual([
      ["progress", 1],
      ["progress", 5],
    ]);
  });

  it("cancel drops the pending update", () => {
    const { sender, send } = createSender();
    const progress = createProgressThrottle(sender, 200, "progress");

    progress.send(1);
    progress.send(2);
    progress.cancel();
    vi.advanceTimersByTime(1_000);

    expect(send.mock.calls).toEqual([["progress", 1]]);
  });

  it("maps the payload and skips a destroyed window", () => {
    const live = createSender();
    createProgressThrottle(live.sender, 200, "progress", (rows) => ({
      rows,
    })).send(7);
    expect(live.send).toHaveBeenCalledWith("progress", { rows: 7 });

    const destroyed = createSender({ destroyed: true });
    createProgressThrottle(destroyed.sender, 200, "progress").send(7);
    expect(destroyed.send).not.toHaveBeenCalled();
  });
});
