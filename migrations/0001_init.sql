CREATE TABLE groups (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- One card per origin
CREATE TABLE sites (
  id           INTEGER PRIMARY KEY,
  group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  origin       TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  -- 0 means no icon; otherwise a cache-busting stamp set when the icon is saved
  icon_version INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX sites_group ON sites(group_id, position);

-- Sub-path links shown on a card
CREATE TABLE links (
  id         INTEGER PRIMARY KEY,
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  title      TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (site_id, path)
);

CREATE TABLE icons (
  site_id      INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  data         BLOB NOT NULL
);
