-- Phase 2: desktops (independent boards), a view mode per desktop, and custom icon addresses.
--
-- A site is now unique per desktop instead of globally, so the tables have to be rebuilt.
-- D1 always enforces foreign keys. The new tables are filled first and the old ones are then
-- dropped children-first, because dropping a parent first would cascade into the rows that
-- still reference it.

CREATE TABLE desktops (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  -- Card layout: large, small or list
  view       TEXT NOT NULL DEFAULT 'large',
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Everything that existed before becomes the first desktop
INSERT INTO desktops (id, name, position, created_at)
VALUES (1, '主桌面', 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TABLE groups_new (
  id         INTEGER PRIMARY KEY,
  desktop_id INTEGER NOT NULL REFERENCES desktops(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  -- Parent key of the composite foreign key on sites
  UNIQUE (id, desktop_id)
);

INSERT INTO groups_new (id, desktop_id, name, position, created_at)
SELECT id, 1, name, position, created_at FROM groups;

-- One card per origin per desktop
CREATE TABLE sites_new (
  id           INTEGER PRIMARY KEY,
  -- Copied from the group so that origin can be unique per desktop. The composite foreign key
  -- keeps the copy honest: a site can't point at a group on another desktop, and moving a
  -- group to another desktop carries its sites along.
  desktop_id   INTEGER NOT NULL,
  group_id     INTEGER NOT NULL,
  origin       TEXT NOT NULL,
  title        TEXT NOT NULL,
  -- 0 means no stored icon, otherwise a cache-busting stamp set when the icon is saved
  icon_version INTEGER NOT NULL DEFAULT 0,
  -- Custom icon address loaded directly by the browser. Takes priority over the stored icon
  icon_url     TEXT,
  position     INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (desktop_id, origin),
  FOREIGN KEY (group_id, desktop_id) REFERENCES groups_new (id, desktop_id) ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO sites_new (id, desktop_id, group_id, origin, title, icon_version, position, created_at)
SELECT id, 1, group_id, origin, title, icon_version, position, created_at FROM sites;

-- Sub-path links shown on a card
CREATE TABLE links_new (
  id         INTEGER PRIMARY KEY,
  site_id    INTEGER NOT NULL REFERENCES sites_new(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  title      TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (site_id, path)
);

INSERT INTO links_new (id, site_id, path, title, position, created_at)
SELECT id, site_id, path, title, position, created_at FROM links;

CREATE TABLE icons_new (
  site_id      INTEGER PRIMARY KEY REFERENCES sites_new(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  data         BLOB NOT NULL
);

INSERT INTO icons_new (site_id, content_type, data)
SELECT site_id, content_type, data FROM icons;

DROP TABLE icons;
DROP TABLE links;
DROP TABLE sites;
DROP TABLE groups;

-- Renaming also rewrites the REFERENCES clauses that point at the renamed table
ALTER TABLE groups_new RENAME TO groups;
ALTER TABLE sites_new RENAME TO sites;
ALTER TABLE links_new RENAME TO links;
ALTER TABLE icons_new RENAME TO icons;

CREATE INDEX groups_desktop ON groups(desktop_id, position);
CREATE INDEX sites_group ON sites(group_id, position);
