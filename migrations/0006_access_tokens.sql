-- Access tokens for the browser extension. Only a hash is stored, so a token has to be handed over
-- (as a connection code) right after it is created and cannot be read back later.
CREATE TABLE access_tokens (
  id           INTEGER PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
