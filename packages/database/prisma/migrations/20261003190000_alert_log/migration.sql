-- Alerts already sent. The scanner looks for what is late every few minutes;
-- each alert carries a key built from what it is about and the date that
-- made it due, so a late payment is announced once, not every ten minutes.
CREATE TABLE IF NOT EXISTS alert_log (
  alert_key text PRIMARY KEY,
  type_code text NOT NULL,
  resource_type_code text NOT NULL,
  resource_id uuid NOT NULL,
  recipients integer NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS alert_log_resource_idx ON alert_log(resource_type_code, resource_id);
