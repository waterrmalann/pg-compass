// Fictional demo data for the interactive previews. It mirrors the
// "Tidewater Supply" database used for the screenshots (scripts/screenshots).

export interface DemoColumn {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface DemoRelation {
  name: string;
  kind: "table" | "view";
  columns: DemoColumn[];
}

export interface DemoSchema {
  name: string;
  relations: DemoRelation[];
}

export interface DemoConnection {
  name: string;
  color: string | null;
  favourite: boolean;
  connected: boolean;
}

const shop: DemoSchema = {
  name: "shop",
  relations: [
    {
      name: "customers",
      kind: "table",
      columns: [
        { name: "id", type: "integer" },
        { name: "name", type: "text" },
        { name: "email", type: "text" },
        { name: "plan", type: "plan" },
        { name: "country", type: "character(2)" },
        { name: "preferences", type: "jsonb" },
        { name: "created_at", type: "timestamptz" },
      ],
    },
    {
      name: "order_items",
      kind: "table",
      columns: [
        { name: "order_id", type: "integer" },
        { name: "sku", type: "text" },
        { name: "quantity", type: "integer" },
      ],
    },
    {
      name: "orders",
      kind: "table",
      columns: [
        { name: "id", type: "integer" },
        { name: "customer_id", type: "integer" },
        { name: "status", type: "order_status" },
        { name: "total", type: "numeric(10,2)" },
        { name: "shipping", type: "jsonb", nullable: true },
        { name: "placed_at", type: "timestamptz" },
      ],
    },
    {
      name: "products",
      kind: "table",
      columns: [
        { name: "sku", type: "text" },
        { name: "name", type: "text" },
        { name: "category", type: "text" },
        { name: "price", type: "numeric(10,2)" },
        { name: "stock", type: "integer" },
        { name: "attributes", type: "jsonb" },
        { name: "embedding", type: "vector", nullable: true },
      ],
    },
    {
      name: "reviews",
      kind: "table",
      columns: [
        { name: "id", type: "integer" },
        { name: "sku", type: "text" },
        { name: "customer_id", type: "integer" },
        { name: "rating", type: "smallint" },
        { name: "body", type: "text", nullable: true },
        { name: "created_at", type: "timestamptz" },
      ],
    },
    {
      name: "order_summaries",
      kind: "view",
      columns: [
        { name: "id", type: "integer", nullable: true },
        { name: "customer", type: "text", nullable: true },
        { name: "status", type: "order_status", nullable: true },
        { name: "total", type: "numeric(10,2)", nullable: true },
        { name: "items", type: "bigint", nullable: true },
        { name: "placed_at", type: "timestamptz", nullable: true },
      ],
    },
  ],
};

const analytics: DemoSchema = {
  name: "analytics",
  relations: [
    {
      name: "events",
      kind: "table",
      columns: [
        { name: "id", type: "bigint" },
        { name: "kind", type: "text" },
        { name: "customer_id", type: "integer", nullable: true },
        { name: "payload", type: "jsonb" },
        { name: "occurred_at", type: "timestamptz" },
      ],
    },
    {
      name: "daily_revenue",
      kind: "view",
      columns: [
        { name: "day", type: "timestamptz", nullable: true },
        { name: "revenue", type: "numeric", nullable: true },
        { name: "orders", type: "bigint", nullable: true },
      ],
    },
  ],
};

export const demoSchemas: DemoSchema[] = [analytics, shop];

export const demoConnections: DemoConnection[] = [
  { name: "Production", color: "#3b82f6", favourite: true, connected: true },
  { name: "Staging", color: "#f59e0b", favourite: false, connected: true },
  { name: "Local", color: null, favourite: false, connected: false },
];

export const demoOrders = [
  { id: 1, customer: "Ada Okafor", status: "delivered", total: "61.13", placedAt: "2026-09-26 18:30" },
  { id: 2, customer: "Hugo Okafor", status: "shipped", total: "98.26", placedAt: "2026-09-26 17:03" },
  { id: 3, customer: "Cleo Lindqvist", status: "paid", total: "135.39", placedAt: "2026-09-26 15:36" },
  { id: 4, customer: "Jonas Lindqvist", status: "delivered", total: "172.52", placedAt: "2026-09-26 14:09" },
  { id: 5, customer: "Elif Moreau", status: "pending", total: "209.65", placedAt: "2026-09-26 12:42" },
  { id: 6, customer: "Greta Tanaka", status: "delivered", total: "246.78", placedAt: "2026-09-26 11:15" },
  { id: 7, customer: "Ines Reyes", status: "refunded", total: "283.91", placedAt: "2026-09-26 09:48" },
];
