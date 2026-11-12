-- One to-do list, shown beside the bookmarks on every desktop.
CREATE TABLE todos (
  -- AUTOINCREMENT, unlike the other tables: to-dos come and go all the time, and an id handed out
  -- again would let a tab that still shows a deleted to-do change the one that took its place
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  -- NULL while the to-do is open, otherwise when it was ticked off
  done_at    INTEGER,
  -- Orders the open to-dos only; finished ones are listed by done_at
  position   INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
