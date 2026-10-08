/**
 * Generates a large, awkward database for ER-diagram tests: hundreds of
 * tables with foreign keys between them, plus the shapes that break naive
 * layouts (cycles, self-references, composite and cross-schema keys,
 * partitioned tables, tables with no relationships, tables with no columns).
 * The output is deterministic so failures reproduce.
 */

export interface DiagramFixtureOptions {
  /** Schema holding the bulk of the tables. */
  schema: string;
  /** Second schema whose tables reference the first. */
  otherSchema: string;
  tableCount: number;
}

export interface DiagramFixture {
  /**
   * SQL to run in order, one query per batch. Creating thousands of tables in
   * one implicit transaction would exhaust the server's lock table.
   */
  batches: string[];
  /** Drops both schemas, a batch of tables at a time for the same reason. */
  dropBatches: string[];
  /** Tables the diagram should draw for `schema` (partitions excluded). */
  tableCount: number;
  /** Foreign keys declared by tables in `schema` (partition copies excluded). */
  foreignKeyCount: number;
  /**
   * Lines the diagram draws for `schema`: every key except the one into a
   * partition, which is not drawn as a card and shows only as a marker.
   */
  drawnRelationshipCount: number;
}

const BATCH_SIZE = 100;

/** Small deterministic PRNG (mulberry32) so the fixture never changes. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function tableName(index: number): string {
  return `t_${String(index).padStart(4, "0")}`;
}

export function buildDiagramFixture(
  options: DiagramFixtureOptions,
): DiagramFixture {
  const random = createRandom(42);
  const schema = quote(options.schema);
  const other = quote(options.otherSchema);
  const statements: string[] = [
    `DROP SCHEMA IF EXISTS ${schema} CASCADE`,
    `DROP SCHEMA IF EXISTS ${other} CASCADE`,
    `CREATE SCHEMA ${schema}`,
    `CREATE SCHEMA ${other}`,
  ];
  let foreignKeyCount = 0;

  // Every fifth table has no foreign keys at all, so the unrelated-table
  // block is exercised; the rest reference one to three earlier tables.
  for (let index = 1; index <= options.tableCount; index += 1) {
    const name = tableName(index);
    const columns = [
      "id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY",
      "code text NOT NULL UNIQUE",
      "label text",
      "created_at timestamptz NOT NULL DEFAULT now()",
    ];
    const extraColumns = Math.floor(random() * 6);
    for (let extra = 0; extra < extraColumns; extra += 1) {
      columns.push(`attribute_${extra} numeric(12, 2)`);
    }

    const isUnrelated = index % 5 === 0 || index === 1;
    if (!isUnrelated) {
      const referenceCount = 1 + Math.floor(random() * 3);
      const targets = new Set<number>();
      for (let r = 0; r < referenceCount; r += 1) {
        // Prefer recent tables so chains form, sometimes reach far back.
        const reach = random() < 0.7 ? 12 : index - 1;
        let target =
          index - 1 - Math.floor(random() * Math.min(reach, index - 1));
        while (target % 5 === 0 && target > 1) target -= 1;
        targets.add(Math.max(target, 2));
      }
      for (const target of targets) {
        if (target >= index) continue;
        columns.push(
          `${tableName(target)}_id bigint REFERENCES ${schema}.${tableName(target)}(id)`,
        );
        foreignKeyCount += 1;
      }
    }

    if (index % 17 === 0) {
      columns.push(`parent_id bigint REFERENCES ${schema}.${name}(id)`);
      foreignKeyCount += 1;
    }

    statements.push(`CREATE TABLE ${schema}.${name} (${columns.join(", ")})`);
  }

  // Cycles: a few earlier tables point forward at later ones.
  for (let index = 3; index <= options.tableCount; index += 41) {
    if (index % 5 === 0) continue;
    const later = Math.min(index + 7, options.tableCount);
    if (later % 5 === 0 || later === index) continue;
    statements.push(
      `ALTER TABLE ${schema}.${tableName(index)} ADD COLUMN cycle_${tableName(later)}_id bigint REFERENCES ${schema}.${tableName(later)}(id)`,
    );
    foreignKeyCount += 1;
  }

  // A composite key and the table that references it.
  statements.push(
    `CREATE TABLE ${schema}.regions (country text, code text, name text NOT NULL, PRIMARY KEY (country, code))`,
    `CREATE TABLE ${schema}.stores (id serial PRIMARY KEY, country text NOT NULL, region_code text NOT NULL, FOREIGN KEY (country, region_code) REFERENCES ${schema}.regions (country, code))`,
  );
  foreignKeyCount += 1;

  // A partitioned table with partitions and a key on the parent; the
  // diagram shows the parent once and none of the partition copies.
  statements.push(
    `CREATE TABLE ${schema}.events (id bigint NOT NULL, occurred_on date NOT NULL, store_id integer REFERENCES ${schema}.stores(id), PRIMARY KEY (id, occurred_on)) PARTITION BY RANGE (occurred_on)`,
    `CREATE TABLE ${schema}.events_2025 PARTITION OF ${schema}.events FOR VALUES FROM ('2025-01-01') TO ('2026-01-01')`,
    `CREATE TABLE ${schema}.events_2026 PARTITION OF ${schema}.events FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')`,
  );
  foreignKeyCount += 1;

  // A key into the partitioned parent: PostgreSQL also copies it once per
  // partition, and only the parent's key is drawn. A key a user declared
  // straight into one partition is their own and is kept.
  statements.push(
    `CREATE TABLE ${schema}.event_notes (id serial PRIMARY KEY, event_id bigint NOT NULL, occurred_on date NOT NULL, FOREIGN KEY (event_id, occurred_on) REFERENCES ${schema}.events (id, occurred_on))`,
    `CREATE TABLE ${schema}.archived_events (id serial PRIMARY KEY, event_id bigint NOT NULL, occurred_on date NOT NULL, FOREIGN KEY (event_id, occurred_on) REFERENCES ${schema}.events_2025 (id, occurred_on))`,
  );
  foreignKeyCount += 2;

  // Unique on its key column alone; the INCLUDE column does not count.
  statements.push(
    `CREATE UNIQUE INDEX regions_name_key ON ${schema}.regions (name) INCLUDE (country)`,
  );

  // A table with no columns at all.
  statements.push(`CREATE TABLE ${schema}.empty_shell ()`);

  // Cross-schema keys: the other schema references the bulk schema.
  statements.push(
    `CREATE TABLE ${other}.audit (id serial PRIMARY KEY, store_id integer REFERENCES ${schema}.stores(id), subject_id bigint REFERENCES ${schema}.${tableName(2)}(id))`,
  );

  const batches: string[] = [];
  for (let start = 0; start < statements.length; start += BATCH_SIZE) {
    const batch = statements.slice(start, start + BATCH_SIZE);
    batches.push(batch.join(";\n") + ";");
  }

  const tableNames = Array.from({ length: options.tableCount }, (_, index) =>
    tableName(index + 1),
  );
  const dropBatches: string[] = [`DROP SCHEMA IF EXISTS ${other} CASCADE`];
  for (let start = 0; start < tableNames.length; start += BATCH_SIZE) {
    const names = tableNames
      .slice(start, start + BATCH_SIZE)
      .map((name) => `${schema}.${name}`);
    dropBatches.push(`DROP TABLE IF EXISTS ${names.join(", ")} CASCADE`);
  }
  dropBatches.push(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);

  // regions, stores, events, event_notes, archived_events, empty_shell
  const extraTableCount = 6;
  return {
    batches,
    dropBatches,
    tableCount: options.tableCount + extraTableCount,
    foreignKeyCount,
    drawnRelationshipCount: foreignKeyCount - 1,
  };
}

/**
 * A small, realistic store schema. Its diagram is easy to read, so it is
 * used for screenshots and for checking relationships by name.
 */
export function buildShopSchemaSql(schemaName: string): string {
  const s = quote(schemaName);
  return `
    DROP SCHEMA IF EXISTS ${s} CASCADE;
    CREATE SCHEMA ${s};
    CREATE TABLE ${s}.customers (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email text NOT NULL UNIQUE,
      full_name text NOT NULL,
      phone text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE ${s}.addresses (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      customer_id bigint NOT NULL REFERENCES ${s}.customers(id),
      line_1 text NOT NULL,
      city text NOT NULL,
      postcode varchar(16),
      country char(2) NOT NULL
    );
    CREATE TABLE ${s}.categories (
      id serial PRIMARY KEY,
      parent_id integer REFERENCES ${s}.categories(id),
      name text NOT NULL,
      slug text NOT NULL UNIQUE
    );
    CREATE TABLE ${s}.suppliers (
      id serial PRIMARY KEY,
      name text NOT NULL,
      contact_email text
    );
    CREATE TABLE ${s}.products (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      category_id integer NOT NULL REFERENCES ${s}.categories(id),
      supplier_id integer REFERENCES ${s}.suppliers(id),
      sku varchar(32) NOT NULL UNIQUE,
      name text NOT NULL,
      price_cents integer NOT NULL,
      attributes jsonb NOT NULL DEFAULT '{}'
    );
    CREATE TABLE ${s}.orders (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      customer_id bigint NOT NULL REFERENCES ${s}.customers(id),
      shipping_address_id bigint REFERENCES ${s}.addresses(id),
      status text NOT NULL DEFAULT 'pending',
      placed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE ${s}.order_items (
      order_id bigint NOT NULL REFERENCES ${s}.orders(id),
      product_id bigint NOT NULL REFERENCES ${s}.products(id),
      quantity integer NOT NULL,
      unit_price_cents integer NOT NULL,
      PRIMARY KEY (order_id, product_id)
    );
    CREATE TABLE ${s}.payments (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id bigint NOT NULL REFERENCES ${s}.orders(id),
      provider text NOT NULL,
      amount_cents integer NOT NULL,
      paid_at timestamptz
    );
    CREATE TABLE ${s}.shipments (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id bigint NOT NULL REFERENCES ${s}.orders(id),
      carrier text NOT NULL,
      tracking_code text UNIQUE,
      shipped_at timestamptz
    );
    CREATE TABLE ${s}.reviews (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      product_id bigint NOT NULL REFERENCES ${s}.products(id),
      customer_id bigint NOT NULL REFERENCES ${s}.customers(id),
      rating smallint NOT NULL,
      body text
    );
    CREATE TABLE ${s}.coupons (
      code text PRIMARY KEY,
      percent_off numeric(5, 2) NOT NULL,
      expires_at timestamptz
    );
    CREATE TABLE ${s}.settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    );
  `;
}
