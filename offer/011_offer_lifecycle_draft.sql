-- HireBeat D1 new schema
-- Group G11: Offer master, immutable terms versions, and lifecycle history
-- Confirmed Revision 1, 2026-08-17
-- Requires G01, G04, G07, G09, and G10.

PRAGMA foreign_keys = ON;

-- One row is the single Offer master for one admitted Application. It stores
-- current lifecycle state plus immutable snapshots of the decision context.
-- Negotiable employment terms belong to offer_version, not this master row.
CREATE TABLE offer (
  id INTEGER PRIMARY KEY,
  offer_uuid TEXT NOT NULL UNIQUE,
  application_id INTEGER NOT NULL UNIQUE,
  candidate_snapshot_id INTEGER NOT NULL UNIQUE,
  creating_stage_run_id INTEGER NOT NULL UNIQUE,
  ml_recommendation_result_id INTEGER UNIQUE,
  current_offer_version_id INTEGER,
  decision_source TEXT NOT NULL
    CHECK (
      decision_source IN (
        'ml_recommendation',
        'manual_hiring_decision',
        'offer_approval'
      )
    ),
  current_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (
      current_status IN (
        'draft', 'preparing', 'ready_to_send', 'sent', 'viewed',
        'accepted', 'declined', 'expired', 'withdrawn', 'cancelled'
      )
    ),
  status_version INTEGER NOT NULL DEFAULT 1 CHECK (status_version >= 1),
  offer_fence_token TEXT NOT NULL,
  company_name_snapshot TEXT NOT NULL,
  position_title_snapshot TEXT NOT NULL,
  candidate_name_snapshot TEXT NOT NULL,
  candidate_email_snapshot TEXT NOT NULL,
  application_work_location_snapshot TEXT,
  application_work_mode_snapshot TEXT,
  requested_start_date_snapshot TEXT,
  requested_end_date_snapshot TEXT,
  work_duration_snapshot TEXT,
  current_status_changed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (application_id)
    REFERENCES application(id) ON DELETE RESTRICT,
  FOREIGN KEY (candidate_snapshot_id, application_id)
    REFERENCES candidate_snapshot(id, application_id) ON DELETE RESTRICT,
  FOREIGN KEY (creating_stage_run_id, application_id)
    REFERENCES application_stage_run(id, application_id) ON DELETE RESTRICT,
  FOREIGN KEY (ml_recommendation_result_id, application_id)
    REFERENCES ml_recommendation_result(id, application_id) ON DELETE RESTRICT,
  FOREIGN KEY (current_offer_version_id, id)
    REFERENCES offer_version(id, offer_id) ON DELETE RESTRICT,
  UNIQUE (id, application_id),
  CHECK (length(trim(offer_uuid)) > 0),
  CHECK (length(trim(offer_fence_token)) > 0),
  CHECK (length(trim(company_name_snapshot)) > 0),
  CHECK (length(trim(position_title_snapshot)) > 0),
  CHECK (length(trim(candidate_name_snapshot)) > 0),
  CHECK (
    length(trim(candidate_email_snapshot)) > 0
    AND length(candidate_email_snapshot)
        - length(replace(candidate_email_snapshot, '@', '')) = 1
  ),
  CHECK (
    decision_source <> 'ml_recommendation'
    OR ml_recommendation_result_id IS NOT NULL
  ),
  CHECK (
    current_status NOT IN (
      'ready_to_send', 'sent', 'viewed', 'accepted',
      'declined', 'expired', 'withdrawn'
    )
    OR current_offer_version_id IS NOT NULL
  )
);

-- One row is one immutable version of the actual Offer terms. A correction or
-- negotiation creates version_no + 1; historical versions are not overwritten.
CREATE TABLE offer_version (
  id INTEGER PRIMARY KEY,
  offer_version_uuid TEXT NOT NULL UNIQUE,
  offer_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  terms_sha256 TEXT NOT NULL,
  offer_title TEXT NOT NULL,
  employment_type_id INTEGER,
  work_location TEXT,
  work_mode TEXT,
  employment_start_date TEXT,
  employment_end_date TEXT,
  work_duration TEXT,
  compensation_amount_minor_units INTEGER
    CHECK (
      compensation_amount_minor_units IS NULL
      OR compensation_amount_minor_units >= 0
    ),
  compensation_currency_code TEXT,
  compensation_period TEXT
    CHECK (
      compensation_period IS NULL
      OR compensation_period IN ('hour', 'day', 'week', 'month', 'year', 'project')
    ),
  signing_bonus_minor_units INTEGER
    CHECK (signing_bonus_minor_units IS NULL OR signing_bonus_minor_units >= 0),
  target_bonus_description TEXT,
  equity_description TEXT,
  response_due_at TEXT,
  offer_terms_json TEXT NOT NULL,
  prepared_by_type TEXT NOT NULL
    CHECK (prepared_by_type IN ('system_ml', 'recruiter', 'external_system')),
  prepared_by_reference TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (offer_id) REFERENCES offer(id) ON DELETE RESTRICT,
  FOREIGN KEY (employment_type_id)
    REFERENCES position_employment_type(id) ON DELETE RESTRICT,
  UNIQUE (id, offer_id),
  UNIQUE (offer_id, version_no),
  UNIQUE (offer_id, terms_sha256),
  CHECK (length(trim(offer_version_uuid)) > 0),
  CHECK (length(terms_sha256) = 64),
  CHECK (length(trim(offer_title)) > 0),
  CHECK (json_valid(offer_terms_json)),
  CHECK (
    (compensation_amount_minor_units IS NULL
      AND compensation_currency_code IS NULL
      AND compensation_period IS NULL)
    OR
    (compensation_amount_minor_units IS NOT NULL
      AND compensation_currency_code IS NOT NULL
      AND compensation_period IS NOT NULL)
  ),
  CHECK (
    compensation_currency_code IS NULL
    OR (
      length(compensation_currency_code) = 3
      AND compensation_currency_code = upper(compensation_currency_code)
    )
  ),
  CHECK (
    employment_start_date IS NULL
    OR employment_end_date IS NULL
    OR employment_end_date >= employment_start_date
  )
);

-- Drafts may omit a response deadline. Once an Offer enters sent, its current
-- immutable version must carry a parseable deadline later than the transition.
-- The Operations API derives a new version from the active configuration when
-- the recruiter did not explicitly provide one; these triggers are the final
-- database-side defense for direct SQL and future writers.
CREATE TRIGGER trg_offer_sent_requires_future_response_due_insert
BEFORE INSERT ON offer
FOR EACH ROW
WHEN NEW.current_status = 'sent'
 AND NOT EXISTS (
   SELECT 1 FROM offer_version AS version
   WHERE version.id = NEW.current_offer_version_id
     AND version.offer_id = NEW.id
     AND version.response_due_at IS NOT NULL
     AND julianday(version.response_due_at) IS NOT NULL
     AND julianday(version.response_due_at) > julianday('now')
 )
BEGIN
  SELECT RAISE(ABORT, 'future_response_due_at_required_for_sent_offer');
END;

CREATE TRIGGER trg_offer_sent_requires_future_response_due_update
BEFORE UPDATE OF current_status, current_offer_version_id ON offer
FOR EACH ROW
WHEN NEW.current_status = 'sent'
 AND NOT EXISTS (
   SELECT 1 FROM offer_version AS version
   WHERE version.id = NEW.current_offer_version_id
     AND version.offer_id = NEW.id
     AND version.response_due_at IS NOT NULL
     AND julianday(version.response_due_at) IS NOT NULL
     AND julianday(version.response_due_at) > julianday('now')
 )
BEGIN
  SELECT RAISE(ABORT, 'future_response_due_at_required_for_sent_offer');
END;

-- One immutable row per lifecycle transition. offer.current_status is a query
-- cache; this history is the auditable record of how that state changed.
CREATE TABLE offer_status_history (
  id INTEGER PRIMARY KEY,
  offer_status_history_uuid TEXT NOT NULL UNIQUE,
  offer_id INTEGER NOT NULL,
  application_id INTEGER NOT NULL,
  offer_version_id INTEGER,
  workflow_run_id INTEGER NOT NULL,
  stage_run_id INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  from_status TEXT
    CHECK (
      from_status IS NULL
      OR from_status IN (
        'draft', 'preparing', 'ready_to_send', 'sent', 'viewed',
        'accepted', 'declined', 'expired', 'withdrawn', 'cancelled'
      )
    ),
  to_status TEXT NOT NULL
    CHECK (
      to_status IN (
        'draft', 'preparing', 'ready_to_send', 'sent', 'viewed',
        'accepted', 'declined', 'expired', 'withdrawn', 'cancelled'
      )
    ),
  initiated_by_type TEXT NOT NULL
    CHECK (
      initiated_by_type IN (
        'system_rule', 'ml', 'recruiter', 'candidate', 'external_system'
      )
    ),
  initiated_by_reference TEXT,
  reason_code TEXT NOT NULL,
  note TEXT,
  event_metadata_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (offer_id, application_id)
    REFERENCES offer(id, application_id) ON DELETE RESTRICT,
  FOREIGN KEY (offer_version_id, offer_id)
    REFERENCES offer_version(id, offer_id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE RESTRICT,
  FOREIGN KEY (stage_run_id, application_id)
    REFERENCES application_stage_run(id, application_id) ON DELETE RESTRICT,
  CHECK (length(trim(offer_status_history_uuid)) > 0),
  CHECK (length(trim(idempotency_key)) > 0),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (json_valid(event_metadata_json)),
  CHECK (
    (from_status IS NULL AND to_status = 'draft')
    OR (from_status IS NOT NULL AND from_status <> to_status)
  ),
  CHECK (
    to_status NOT IN (
      'ready_to_send', 'sent', 'viewed', 'accepted',
      'declined', 'expired', 'withdrawn'
    )
    OR offer_version_id IS NOT NULL
  )
);

CREATE INDEX idx_offer_current_status
  ON offer (current_status, current_status_changed_at);

CREATE INDEX idx_offer_candidate_snapshot
  ON offer (candidate_snapshot_id);

CREATE INDEX idx_offer_ml_recommendation
  ON offer (ml_recommendation_result_id);

CREATE INDEX idx_offer_version_offer_created
  ON offer_version (offer_id, created_at);

CREATE INDEX idx_offer_history_offer_occurred
  ON offer_status_history (offer_id, occurred_at, id);

CREATE INDEX idx_offer_history_workflow
  ON offer_status_history (workflow_run_id);
