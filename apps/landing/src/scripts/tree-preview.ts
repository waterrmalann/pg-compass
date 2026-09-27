import { demoConnections, demoSchemas, type DemoRelation } from "../lib/demo";

interface OpenTab {
  key: string;
  connection: string;
  schema: string;
  relation: string;
}

const MAX_TABS = 4;

function findRelation(schemaName: string, relationName: string): DemoRelation | undefined {
  const schema = demoSchemas.find((item) => item.name === schemaName);
  return schema?.relations.find((item) => item.name === relationName);
}

function colorFor(connectionName: string): string | null {
  return demoConnections.find((item) => item.name === connectionName)?.color ?? null;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Same recipe as the desktop tab strip (docs/DESIGN.md §15): a light tint
// of the connection colour, stronger on the active tab.
function tintTab(node: HTMLElement, color: string, isActive: boolean) {
  const fill = isActive
    ? `color-mix(in oklab, ${color} 16%, var(--background))`
    : `color-mix(in oklab, ${color} 9%, transparent)`;
  const border = isActive
    ? `color-mix(in oklab, ${color} 45%, var(--border))`
    : `color-mix(in oklab, ${color} 22%, transparent)`;
  node.style.backgroundColor = fill;
  node.style.borderColor = border;
}

export function setupTreePreview() {
  const root = document.querySelector<HTMLElement>("[data-tree-preview]");
  if (!root) return;

  const strip = root.querySelector<HTMLElement>("[data-tab-strip]")!;
  const breadcrumb = root.querySelector<HTMLElement>("[data-breadcrumb]")!;
  const columnsBody = root.querySelector<HTMLElement>("[data-columns]")!;
  const relationButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-open-relation]")];

  let tabs: OpenTab[] = [
    { key: "Staging/analytics/events", connection: "Staging", schema: "analytics", relation: "events" },
    { key: "Production/shop/customers", connection: "Production", schema: "shop", relation: "customers" },
    { key: "Production/shop/orders", connection: "Production", schema: "shop", relation: "orders" },
  ];
  let activeKey = "Production/shop/orders";

  function renderTabs() {
    const tabNodes = tabs.map((tab) => {
      const isActive = tab.key === activeKey;
      const color = colorFor(tab.connection);
      const item = element(
        "div",
        [
          "group flex h-7 w-32 shrink-0 items-center gap-1.5 rounded-md border pr-0.5 pl-2.5 text-xs transition-colors duration-150",
          isActive
            ? "border-border bg-background font-medium text-foreground shadow-xs/5 dark:shadow-edge"
            : "border-transparent text-muted-foreground hover:text-foreground",
        ].join(" "),
      );
      item.setAttribute("role", "listitem");
      if (color) {
        tintTab(item, color, isActive);
        const dot = element("span", "size-1.5 shrink-0 rounded-full");
        dot.style.backgroundColor = color;
        item.append(dot);
      }

      const select = element("button", "h-full min-w-0 flex-1 cursor-pointer truncate text-left outline-none focus-visible:underline", tab.relation);
      select.type = "button";
      select.title = `${tab.connection} / ${tab.schema} / ${tab.relation}`;
      select.setAttribute("aria-current", isActive ? "page" : "false");
      select.addEventListener("click", () => {
        activeKey = tab.key;
        render();
      });

      const close = element(
        "button",
        "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-[13px] leading-none text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100",
        "×",
      );
      close.type = "button";
      close.setAttribute("aria-label", `Close ${tab.relation}`);
      if (isActive) close.classList.add("opacity-100");
      close.addEventListener("click", () => closeTab(tab.key));

      item.append(select, close);
      return item;
    });

    if (tabNodes.length === 0) {
      strip.replaceChildren(element("span", "px-2.5 text-xs text-muted-foreground", "No tabs open"));
      return;
    }
    strip.replaceChildren(...tabNodes);

    // Keep the active tab visible without scrolling the page itself.
    const activeNode = tabNodes[tabs.findIndex((tab) => tab.key === activeKey)];
    if (activeNode) {
      const overflowRight = activeNode.offsetLeft + activeNode.offsetWidth - (strip.scrollLeft + strip.clientWidth);
      const overflowLeft = strip.scrollLeft - activeNode.offsetLeft;
      if (overflowRight > 0) strip.scrollLeft += overflowRight + 6;
      if (overflowLeft > 0) strip.scrollLeft -= overflowLeft + 6;
    }
  }

  function renderDetail() {
    const tab = tabs.find((item) => item.key === activeKey);
    if (!tab) {
      breadcrumb.replaceChildren(element("span", "text-muted-foreground", "Pick a table in the tree."));
      columnsBody.replaceChildren();
      return;
    }

    breadcrumb.replaceChildren(
      element("span", "truncate font-mono text-xs text-muted-foreground", tab.connection),
      element("span", "text-muted-foreground", "/"),
      element("span", "font-mono text-xs text-muted-foreground", tab.schema),
      element("span", "text-muted-foreground", "/"),
      element("span", "truncate font-medium", tab.relation),
    );

    const relation = findRelation(tab.schema, tab.relation);
    const rows = (relation?.columns ?? []).map((column) => {
      const row = element("tr", "border-b border-border/70 transition-colors last:border-b-0 hover:bg-muted/40");
      row.append(
        element("td", "h-8 px-2 font-mono text-[12.5px]", column.name),
        element("td", "h-8 px-2 font-mono text-[11px] text-subtle-foreground", column.type),
        element("td", "hidden h-8 px-2 text-xs text-muted-foreground md:table-cell", column.nullable ? "Nullable" : "Not null"),
      );
      return row;
    });
    columnsBody.replaceChildren(...rows);
  }

  function renderSelection() {
    relationButtons.forEach((button) => {
      const key = `${button.dataset.connectionName}/${button.dataset.schema}/${button.dataset.relation}`;
      button.setAttribute("aria-pressed", String(key === activeKey));
    });
  }

  function render() {
    renderTabs();
    renderDetail();
    renderSelection();
  }

  function openTab(tab: OpenTab) {
    if (!tabs.some((item) => item.key === tab.key)) {
      tabs = [...tabs, tab].slice(-MAX_TABS);
    }
    activeKey = tab.key;
    render();
  }

  function closeTab(key: string) {
    const index = tabs.findIndex((item) => item.key === key);
    tabs = tabs.filter((item) => item.key !== key);
    if (activeKey === key) {
      const neighbour = tabs[Math.min(index, tabs.length - 1)];
      activeKey = neighbour?.key ?? "";
    }
    render();
  }

  relationButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const connection = button.dataset.connectionName!;
      const schema = button.dataset.schema!;
      const relation = button.dataset.relation!;
      openTab({ key: `${connection}/${schema}/${relation}`, connection, schema, relation });
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
    });
  });

  render();
}
