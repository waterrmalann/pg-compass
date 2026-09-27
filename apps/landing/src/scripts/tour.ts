const SCENE_DURATION_MS = 6000;

export function setupTour() {
  const root = document.querySelector<HTMLElement>("[data-tour]");
  if (!root) return;

  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-tour-tab]")];
  const panels = [...root.querySelectorAll<HTMLElement>("[data-scene]")];
  const title = root.querySelector<HTMLElement>("[data-tour-title]");
  const caption = root.querySelector<HTMLElement>("[data-tour-caption]");
  const toggle = root.querySelector<HTMLButtonElement>("[data-tour-toggle]");
  const pauseIcon = toggle?.querySelector("[data-icon-pause]");
  const playIcon = toggle?.querySelector("[data-icon-play]");

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let playing = !prefersReducedMotion;
  let hovering = false;
  let activeIndex = 0;
  let timer: number | undefined;

  function select(index: number) {
    activeIndex = (index + tabs.length) % tabs.length;
    const activeTab = tabs[activeIndex]!;

    tabs.forEach((tab, tabIndex) => {
      const isActive = tabIndex === activeIndex;
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.toggleAttribute("data-active", panel.dataset.scene === activeTab.dataset.tourTab);
    });
    if (title) title.textContent = activeTab.dataset.title ?? "";
    if (caption) caption.textContent = activeTab.dataset.caption ?? "";
  }

  function schedule() {
    window.clearTimeout(timer);
    if (!playing || hovering || document.hidden) return;
    timer = window.setTimeout(() => {
      select(activeIndex + 1);
      schedule();
    }, SCENE_DURATION_MS);
  }

  function setPlaying(next: boolean) {
    playing = next;
    toggle?.setAttribute("aria-label", playing ? "Pause the tour" : "Play the tour");
    pauseIcon?.classList.toggle("hidden", !playing);
    playIcon?.classList.toggle("hidden", playing);
    schedule();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      select(index);
      // Picking a scene by hand means the viewer wants to look at it.
      setPlaying(false);
    });
    tab.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      select(index + step);
      tabs[activeIndex]!.focus();
      setPlaying(false);
    });
  });

  toggle?.addEventListener("click", () => setPlaying(!playing));

  const frame = root.querySelector<HTMLElement>("[data-tour-frame]");
  frame?.addEventListener("pointerenter", () => {
    hovering = true;
    schedule();
  });
  frame?.addEventListener("pointerleave", () => {
    hovering = false;
    schedule();
  });
  document.addEventListener("visibilitychange", schedule);

  setPlaying(playing);
}
