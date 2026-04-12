-- Products table: normalized catalog from the Excel source
CREATE TABLE IF NOT EXISTS products (
  id                  SERIAL PRIMARY KEY,
  internal_id         INTEGER NOT NULL UNIQUE,
  description         TEXT    NOT NULL,
  brand               TEXT    NOT NULL,
  supplier_article_no TEXT,
  gtin_ean            TEXT,
  order_unit          TEXT    NOT NULL,
  base_unit           TEXT    NOT NULL,
  base_units_per_bme  INTEGER NOT NULL,
  net_target_price    NUMERIC(12, 4),
  currency            TEXT    NOT NULL DEFAULT 'CHF',
  annual_quantity     INTEGER,
  mdr_class           TEXT,
  -- generated full-text search column (simple config: no stemming, handles mixed brand names)
  search_text         TEXT GENERATED ALWAYS AS (
    lower(description || ' ' || brand)
  ) STORED,
  search_tsv          TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', lower(description || ' ' || brand))
  ) STORED,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_search_idx ON products USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS products_internal_id_idx ON products (internal_id);
CREATE INDEX IF NOT EXISTS products_gtin_idx ON products (gtin_ean) WHERE gtin_ean IS NOT NULL;

-- Reorder requests table
CREATE TABLE IF NOT EXISTS reorder_requests (
  request_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID        NOT NULL,
  internal_id         INTEGER     NOT NULL REFERENCES products(internal_id),
  quantity            INTEGER     NOT NULL CHECK (quantity > 0),
  order_unit          TEXT        NOT NULL,
  base_unit_quantity  INTEGER     NOT NULL CHECK (base_unit_quantity > 0),
  delivery_location   TEXT        NOT NULL,
  cost_center         TEXT        NOT NULL,
  requested_by_date   DATE        NOT NULL,
  justification       TEXT,
  status              TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reorder_requests_session_idx ON reorder_requests (session_id);
CREATE INDEX IF NOT EXISTS reorder_requests_internal_id_idx ON reorder_requests (internal_id);
