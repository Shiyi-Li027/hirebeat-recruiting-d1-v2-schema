-- Prevent the same authenticated business command from being applied twice.
-- The command idempotency key is stored in audit_event.correlation_key.

CREATE UNIQUE INDEX uq_audit_event_command_idempotency
  ON audit_event (event_type, correlation_key)
  WHERE event_type LIKE 'command.%' AND correlation_key IS NOT NULL;
