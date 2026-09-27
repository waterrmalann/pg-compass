-- Demo data for landing-page screenshots: "Tidewater Supply", a fictional
-- outdoor-gear shop. Deterministic (no random()), so reshoots stay stable.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA shop;
CREATE SCHEMA analytics;

CREATE TYPE shop.plan AS ENUM ('free', 'member', 'crew');
CREATE TYPE shop.order_status AS ENUM ('pending', 'paid', 'shipped', 'delivered', 'refunded');

CREATE TABLE shop.customers (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL UNIQUE,
  plan        shop.plan NOT NULL DEFAULT 'free',
  country     char(2) NOT NULL,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop.products (
  sku        text PRIMARY KEY,
  name       text NOT NULL,
  category   text NOT NULL,
  price      numeric(10, 2) NOT NULL CHECK (price > 0),
  stock      integer NOT NULL DEFAULT 0,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding  vector(4)
);

CREATE TABLE shop.orders (
  id          serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES shop.customers (id),
  status      shop.order_status NOT NULL DEFAULT 'pending',
  total       numeric(10, 2) NOT NULL,
  shipping    jsonb,
  placed_at   timestamptz NOT NULL
);
CREATE INDEX orders_customer_id_idx ON shop.orders (customer_id);
CREATE INDEX orders_placed_at_idx ON shop.orders (placed_at DESC);

CREATE TABLE shop.order_items (
  order_id integer NOT NULL REFERENCES shop.orders (id) ON DELETE CASCADE,
  sku      text NOT NULL REFERENCES shop.products (sku),
  quantity integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, sku)
);

CREATE TABLE shop.reviews (
  id          serial PRIMARY KEY,
  sku         text NOT NULL REFERENCES shop.products (sku),
  customer_id integer NOT NULL REFERENCES shop.customers (id),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        text,
  created_at  timestamptz NOT NULL
);

CREATE TABLE analytics.events (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  customer_id integer,
  payload     jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);

INSERT INTO shop.customers (name, email, plan, country, preferences, created_at)
SELECT
  f.first || ' ' || l.last,
  lower(f.first) || '.' || lower(l.last) || '@' || (ARRAY['fastmail.com', 'proton.me', 'gmail.com', 'hey.com'])[1 + (f.i + l.i) % 4],
  (ARRAY['free', 'member', 'member', 'crew'])[1 + (f.i * 3 + l.i) % 4]::shop.plan,
  (ARRAY['US', 'GB', 'DE', 'NL', 'CA', 'SE', 'NZ', 'JP'])[1 + (f.i + l.i * 2) % 8],
  jsonb_build_object(
    'newsletter', (f.i + l.i) % 3 <> 0,
    'units', CASE WHEN (f.i + l.i) % 5 = 0 THEN 'imperial' ELSE 'metric' END,
    'interests', (ARRAY['["climbing", "camping"]', '["trail running"]', '["sailing", "kayaking"]', '["camping", "cooking"]'])[1 + (f.i + l.i) % 4]::jsonb
  ),
  timestamptz '2025-01-06 09:00+00' + ((f.i * 11 + l.i * 7) || ' days')::interval + ((f.i * 37 + l.i * 13) % 600 || ' minutes')::interval
FROM unnest(ARRAY['Ada', 'Bram', 'Cleo', 'Dev', 'Elif', 'Finn', 'Greta', 'Hugo', 'Ines', 'Jonas']) WITH ORDINALITY AS f(first, i)
CROSS JOIN unnest(ARRAY['Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Reyes', 'Whitlock']) WITH ORDINALITY AS l(last, i);

INSERT INTO shop.products (sku, name, category, price, stock, attributes, embedding) VALUES
  ('TW-1001', 'Harbor rain shell',        'Apparel',  189.00,  42, '{"sizes": ["S", "M", "L", "XL"], "waterproof": true, "weight_g": 310}', '[0.12, 0.88, 0.31, 0.05]'),
  ('TW-1002', 'Ridgeline fleece',          'Apparel',   96.00, 118, '{"sizes": ["XS", "S", "M", "L"], "recycled": true}', '[0.18, 0.79, 0.22, 0.10]'),
  ('TW-1003', 'Merino base layer',         'Apparel',   74.00,  64, '{"sizes": ["S", "M", "L"], "gsm": 200}', '[0.09, 0.71, 0.40, 0.02]'),
  ('TW-2001', 'Two-person tarp tent',      'Shelter',  329.00,  12, '{"capacity": 2, "weight_g": 890, "season": "3"}', '[0.81, 0.14, 0.33, 0.47]'),
  ('TW-2002', 'Down quilt, 0°C',           'Shelter',  259.00,  21, '{"fill_power": 850, "temp_c": 0}', '[0.77, 0.21, 0.29, 0.52]'),
  ('TW-2003', 'Inflatable sleeping pad',   'Shelter',  149.00,  37, '{"r_value": 4.2, "length_cm": 183}', '[0.72, 0.18, 0.35, 0.41]'),
  ('TW-3001', 'Titanium pot, 750 ml',      'Kitchen',   54.00, 203, '{"material": "titanium", "volume_ml": 750}', '[0.33, 0.12, 0.84, 0.19]'),
  ('TW-3002', 'Canister stove',            'Kitchen',   69.00,  88, '{"fuel": "isobutane", "boil_time_s": 210}', '[0.29, 0.16, 0.90, 0.22]'),
  ('TW-3003', 'Pour-over coffee kit',      'Kitchen',   38.00,   0, '{"includes": ["dripper", "filters", "grinder"]}', '[0.25, 0.20, 0.78, 0.11]'),
  ('TW-4001', 'Headlamp, 400 lm',          'Tools',     49.00, 156, '{"lumens": 400, "battery": "USB-C"}', '[0.41, 0.33, 0.20, 0.86]'),
  ('TW-4002', 'Folding knife',             'Tools',     62.00,  74, '{"blade_mm": 76, "steel": "14C28N"}', '[0.38, 0.29, 0.26, 0.80]'),
  ('TW-4003', 'Baseplate compass',         'Tools',     34.00,  95, '{"declination": "adjustable", "mirror": false}', '[0.44, 0.36, 0.18, 0.91]'),
  ('TW-5001', '40 L alpine pack',          'Packs',    219.00,  29, '{"volume_l": 40, "frame": "removable"}', '[0.63, 0.52, 0.12, 0.38]'),
  ('TW-5002', 'Dry bag set',               'Packs',     44.00, 131, '{"sizes_l": [5, 10, 20]}', '[0.58, 0.61, 0.19, 0.30]'),
  ('TW-5003', 'Trail running vest',        'Packs',    129.00,   8, '{"volume_l": 8, "flasks": 2}', '[0.55, 0.49, 0.15, 0.44]');

INSERT INTO shop.orders (customer_id, status, total, shipping, placed_at)
SELECT
  1 + (n * 7) % 60,
  (ARRAY['delivered', 'delivered', 'shipped', 'paid', 'delivered', 'pending', 'delivered', 'refunded'])[1 + n % 8]::shop.order_status,
  round((24 + (n * 37) % 410 + ((n * 13) % 100) / 100.0)::numeric, 2),
  CASE WHEN n % 6 = 5 THEN NULL ELSE jsonb_build_object(
    'carrier', (ARRAY['DHL', 'UPS', 'PostNL', 'Royal Mail'])[1 + n % 4],
    'method', (ARRAY['standard', 'express'])[1 + (n / 3) % 2],
    'tracking', 'TW' || lpad((n * 7919 % 1000000)::text, 6, '0')
  ) END,
  timestamptz '2026-09-26 18:40+00' - ((n * 97) % 1440 || ' minutes')::interval - (n / 9 || ' days')::interval
FROM generate_series(1, 240) AS n;

INSERT INTO shop.order_items (order_id, sku, quantity)
SELECT o.id, p.sku, 1 + (o.id + p.ord) % 3
FROM shop.orders o
JOIN LATERAL (
  SELECT sku, row_number() OVER (ORDER BY sku) AS ord FROM shop.products
) p ON (p.ord + o.id) % 6 = 0;

INSERT INTO shop.reviews (sku, customer_id, rating, body, created_at)
SELECT
  (SELECT sku FROM shop.products ORDER BY sku OFFSET (n % 15) LIMIT 1),
  1 + (n * 11) % 60,
  (ARRAY[5, 4, 5, 3, 5, 4, 2, 5])[1 + n % 8],
  (ARRAY['Survived a week of Scottish drizzle.', 'Lighter than expected.', 'Packs down small, sets up fast.', 'Runs a size small.', 'Worth every gram.', 'Zip is a bit stiff.', NULL, 'Bought a second one for my partner.'])[1 + n % 8],
  timestamptz '2026-09-20 12:00+00' - (n * 3 || ' hours')::interval
FROM generate_series(1, 90) AS n;

INSERT INTO analytics.events (kind, customer_id, payload, occurred_at)
SELECT
  (ARRAY['page_view', 'add_to_cart', 'checkout', 'search'])[1 + n % 4],
  1 + (n * 5) % 60,
  jsonb_build_object('path', (ARRAY['/packs', '/shelter', '/kitchen', '/checkout'])[1 + n % 4], 'ms', 80 + (n * 31) % 900),
  timestamptz '2026-09-27 08:00+00' - (n * 4 || ' minutes')::interval
FROM generate_series(1, 400) AS n;

CREATE VIEW shop.order_summaries AS
SELECT
  o.id,
  c.name AS customer,
  o.status,
  o.total,
  count(i.sku) AS items,
  o.placed_at
FROM shop.orders o
JOIN shop.customers c ON c.id = o.customer_id
LEFT JOIN shop.order_items i ON i.order_id = o.id
GROUP BY o.id, c.name;

CREATE VIEW analytics.daily_revenue AS
SELECT date_trunc('day', placed_at) AS day, sum(total) AS revenue, count(*) AS orders
FROM shop.orders
WHERE status <> 'refunded'
GROUP BY 1;

ANALYZE;
