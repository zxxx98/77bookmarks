-- Pinned groups are listed before the others on their desktop. Position still orders the groups
-- inside each of the two segments, so unpinning puts a group back among the unpinned ones.
ALTER TABLE groups ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
