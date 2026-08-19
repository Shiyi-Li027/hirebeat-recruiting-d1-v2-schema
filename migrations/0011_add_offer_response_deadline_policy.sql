-- Add a versioned default Offer response window and enforce that an Offer
-- cannot enter sent without a valid future deadline on its current version.

INSERT INTO system_configuration_release (
  configuration_release_key, release_version, release_status,
  release_description, created_by, created_at, updated_at
)
VALUES (
  'hirebeat-system-configuration-v2', 2, 'draft',
  'Adds the default Offer response window while preserving all v1 runtime settings.',
  'migration:0011',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO system_configuration (
  configuration_release_id, configuration_scope, configuration_key,
  configuration_value_json, description, created_at
)
SELECT
  target.id, source.configuration_scope, source.configuration_key,
  source.configuration_value_json, source.description,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM system_configuration_release AS target
JOIN system_configuration_release AS prior
  ON prior.configuration_release_key = 'hirebeat-system-configuration-v1'
JOIN system_configuration AS source
  ON source.configuration_release_id = prior.id
WHERE target.configuration_release_key = 'hirebeat-system-configuration-v2';

INSERT INTO system_configuration (
  configuration_release_id, configuration_scope, configuration_key,
  configuration_value_json, description, created_at
)
SELECT
  id, 'offer', 'default_response_window_days', '7',
  'Default whole-day response window calculated from the actual Offer sent instant when the recruiter did not provide an explicit deadline.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM system_configuration_release
WHERE configuration_release_key = 'hirebeat-system-configuration-v2';

UPDATE system_configuration_release
SET release_status = 'superseded',
    superseded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE configuration_release_key = 'hirebeat-system-configuration-v1'
  AND release_status = 'active';

UPDATE system_configuration_release
SET release_status = 'active',
    activated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    activated_by = 'migration:0011',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE configuration_release_key = 'hirebeat-system-configuration-v2'
  AND release_status = 'draft';

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

-- Force every pre-migration sent Offer through the new invariant. The
-- migration rolls back atomically if an invalid historical row exists.
UPDATE offer
SET current_status = current_status
WHERE current_status = 'sent';
