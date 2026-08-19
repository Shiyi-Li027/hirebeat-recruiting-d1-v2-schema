-- Catalog revisions are an ordered publication history. If the option tree
-- changes A -> B -> A, the second A must receive a new revision number even
-- though its integrity hash matches the historical first A revision.

PRAGMA defer_foreign_keys = on;

CREATE TABLE catalog_revision_rebuild (
  id INTEGER PRIMARY KEY,
  catalog_revision_uuid TEXT NOT NULL UNIQUE,
  revision_number INTEGER NOT NULL UNIQUE CHECK (revision_number >= 1),
  catalog_snapshot_json TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  change_reason TEXT,
  created_by_actor TEXT,
  created_at TEXT NOT NULL,
  CHECK (length(trim(catalog_revision_uuid)) > 0),
  CHECK (length(trim(catalog_snapshot_json)) > 0),
  CHECK (length(snapshot_sha256) = 64)
);

INSERT INTO catalog_revision_rebuild (
  id,
  catalog_revision_uuid,
  revision_number,
  catalog_snapshot_json,
  snapshot_sha256,
  change_reason,
  created_by_actor,
  created_at
)
SELECT
  id,
  catalog_revision_uuid,
  revision_number,
  catalog_snapshot_json,
  snapshot_sha256,
  change_reason,
  created_by_actor,
  created_at
FROM catalog_revision;

DROP TABLE catalog_revision;

ALTER TABLE catalog_revision_rebuild
RENAME TO catalog_revision;

PRAGMA defer_foreign_keys = off;
