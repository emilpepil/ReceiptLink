CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  domain TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  seller TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  amount TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  delivery_url TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  creation_tx TEXT,
  payment_tx TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_seller ON invoices(seller, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS auth_nonces_expiry ON auth_nonces(expires_at);
