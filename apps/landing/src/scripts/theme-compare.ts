const KEY_STEP = 5;

export function setupThemeCompare() {
  const slider = document.querySelector<HTMLElement>("[data-compare]");
  if (!slider) return;

  let dragging = false;

  function setSplit(percent: number) {
    const clamped = Math.max(0, Math.min(100, percent));
    const rounded = Math.round(clamped);
    slider!.style.setProperty("--split", `${clamped}%`);
    slider!.setAttribute("aria-valuenow", String(rounded));
    slider!.setAttribute("aria-valuetext", `${rounded}% dark`);
  }

  function setSplitFromPointer(clientX: number) {
    const bounds = slider!.getBoundingClientRect();
    setSplit(((clientX - bounds.left) / bounds.width) * 100);
  }

  slider.addEventListener("pointerdown", (event) => {
    dragging = true;
    slider.setPointerCapture(event.pointerId);
    setSplitFromPointer(event.clientX);
  });
  slider.addEventListener("pointermove", (event) => {
    if (dragging) setSplitFromPointer(event.clientX);
  });
  slider.addEventListener("pointerup", () => {
    dragging = false;
  });
  slider.addEventListener("pointercancel", () => {
    dragging = false;
  });

  slider.addEventListener("keydown", (event) => {
    const current = Number(slider.getAttribute("aria-valuenow") ?? 50);
    const targets: Record<string, number> = {
      ArrowLeft: current - KEY_STEP,
      ArrowDown: current - KEY_STEP,
      ArrowRight: current + KEY_STEP,
      ArrowUp: current + KEY_STEP,
      Home: 0,
      End: 100,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setSplit(next);
  });
}
