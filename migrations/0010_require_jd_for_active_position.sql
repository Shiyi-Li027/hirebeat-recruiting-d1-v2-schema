-- Position drafts may have no JD. Active Positions must have a minimally
-- usable JD because they are selectable and become ML decision inputs.
CREATE TRIGGER trg_position_active_requires_jd_insert
BEFORE INSERT ON position
FOR EACH ROW
WHEN NEW.position_status = 'active'
 AND (NEW.position_jd IS NULL OR length(trim(NEW.position_jd)) < 10)
BEGIN
  SELECT RAISE(ABORT, 'position_jd_required_for_active');
END;

CREATE TRIGGER trg_position_active_requires_jd_update
BEFORE UPDATE OF position_status, position_jd ON position
FOR EACH ROW
WHEN NEW.position_status = 'active'
 AND (NEW.position_jd IS NULL OR length(trim(NEW.position_jd)) < 10)
BEGIN
  SELECT RAISE(ABORT, 'position_jd_required_for_active');
END;

-- Force the new invariant to inspect pre-migration rows. If an older active
-- Position has no usable JD, the migration fails atomically instead of
-- silently leaving an invalid selectable Position behind.
UPDATE position
SET position_status = position_status
WHERE position_status = 'active'
  AND (position_jd IS NULL OR length(trim(position_jd)) < 10);
