import type { ITheme } from "@xterm/xterm";

/**
 * Resolves a CSS colour expression (tokens are `color-mix()` chains) to a
 * `#rrggbb` / `rgba()` string xterm.js can parse, using a hidden probe
 * element and a 1×1 canvas.
 */
function createColorResolver(host: HTMLElement): {
  resolve: (cssColor: string) => string;
  dispose: () => void;
} {
  const probe = document.createElement("span");
  probe.style.display = "none";
  host.appendChild(probe);
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  function resolve(cssColor: string): string {
    probe.style.color = "";
    probe.style.color = cssColor;
    const computed = getComputedStyle(probe).color;
    if (!context) return computed;

    context.clearRect(0, 0, 1, 1);
    context.fillStyle = computed;
    context.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0, alpha = 255] = context.getImageData(
      0,
      0,
      1,
      1,
    ).data;
    if (alpha === 255) {
      const hex = [red, green, blue]
        .map((channel) => channel.toString(16).padStart(2, "0"))
        .join("");
      return `#${hex}`;
    }
    return `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(3)})`;
  }

  return { resolve, dispose: () => probe.remove() };
}

/**
 * Terminal colours from the Quiet Utility tokens (docs/DESIGN.md §2, §9.19):
 * a card-coloured surface with foreground text. ANSI hues map to the status
 * and chart tokens so psql's own colours (errors, prompts) read like the app.
 */
export function buildTerminalTheme(host: HTMLElement): ITheme {
  const { resolve, dispose } = createColorResolver(host);
  try {
    const foreground = resolve("var(--foreground)");
    const muted = resolve("var(--muted-foreground)");
    return {
      background: resolve("var(--card)"),
      foreground,
      cursor: foreground,
      cursorAccent: resolve("var(--card)"),
      selectionBackground: resolve(
        "color-mix(in oklab, var(--foreground) 22%, transparent)",
      ),
      scrollbarSliderBackground: resolve(
        "color-mix(in oklab, var(--foreground) 12%, transparent)",
      ),
      scrollbarSliderHoverBackground: resolve(
        "color-mix(in oklab, var(--foreground) 20%, transparent)",
      ),
      scrollbarSliderActiveBackground: resolve(
        "color-mix(in oklab, var(--foreground) 28%, transparent)",
      ),
      black: muted,
      red: resolve("var(--destructive-foreground)"),
      green: resolve("var(--success-foreground)"),
      yellow: resolve("var(--warning-foreground)"),
      blue: resolve("var(--info-foreground)"),
      magenta: resolve("var(--chart-4)"),
      cyan: resolve("var(--chart-3)"),
      white: foreground,
      brightBlack: muted,
      brightRed: resolve("var(--destructive-foreground)"),
      brightGreen: resolve("var(--success-foreground)"),
      brightYellow: resolve("var(--warning-foreground)"),
      brightBlue: resolve("var(--info-foreground)"),
      brightMagenta: resolve("var(--chart-4)"),
      brightCyan: resolve("var(--chart-3)"),
      brightWhite: foreground,
    };
  } finally {
    dispose();
  }
}
