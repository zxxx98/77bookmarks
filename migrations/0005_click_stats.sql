-- Usage counters behind the "使用统计" view: how often a card's homepage and each of its links were
-- opened from the bookmark page, and when that last happened (milliseconds, NULL until the first click).
ALTER TABLE sites ADD COLUMN click_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN last_clicked_at INTEGER;
ALTER TABLE links ADD COLUMN click_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE links ADD COLUMN last_clicked_at INTEGER;

-- When counting started. Bookmarks older than this can only be called unused since this moment,
-- not since they were added.
INSERT OR IGNORE INTO settings (key, value)
VALUES ('click_stats_since', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
