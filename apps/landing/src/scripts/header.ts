const THEME_KEY = "pgc-theme";

function setupThemeToggle() {
  const toggle = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  if (!toggle) return;

  toggle.addEventListener("click", () => {
    const root = document.documentElement;
    const isDark = root.classList.toggle("dark");
    try {
      localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
    } catch {
      // Storage can be unavailable (private windows); the toggle still works.
    }
  });
}

function setupMobileMenu() {
  const menu = document.querySelector<HTMLDialogElement>("[data-menu]");
  const openButton = document.querySelector<HTMLButtonElement>("[data-menu-open]");
  const closeButton = document.querySelector<HTMLButtonElement>("[data-menu-close]");
  if (!menu || !openButton || !closeButton) return;

  openButton.addEventListener("click", () => menu.showModal());
  closeButton.addEventListener("click", () => menu.close());

  // Clicking the scrim (the dialog element itself, outside its content)
  // closes the drawer, as does following an in-page link.
  menu.addEventListener("click", (event) => {
    const clickedScrim = event.target === menu;
    const clickedLink = (event.target as HTMLElement).closest("[data-menu-link]");
    if (clickedScrim || clickedLink) menu.close();
  });
}

export function setupHeader() {
  setupThemeToggle();
  setupMobileMenu();
}
