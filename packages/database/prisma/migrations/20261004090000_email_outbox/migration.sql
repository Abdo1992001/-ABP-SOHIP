-- Email leaves through one outbox: quotations to customers, notifications to
-- staff, test messages. The worker sends what is due, retries what failed,
-- and records what the mail server said.
CREATE TABLE email_messages (
  email_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose_code text NOT NULL,
  to_addresses text[] NOT NULL,
  cc_addresses text[] NOT NULL DEFAULT '{}',
  reply_to text,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  resource_type_code text,
  resource_id uuid,
  status_code text NOT NULL DEFAULT 'QUEUED',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error text,
  provider_message_id text,
  created_by_user_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at timestamptz(6),
  CONSTRAINT email_messages_status_check
    CHECK (status_code IN ('QUEUED', 'SENDING', 'SENT', 'FAILED')),
  CONSTRAINT email_messages_recipient_check
    CHECK (cardinality(to_addresses) > 0)
);
CREATE INDEX email_messages_due_idx ON email_messages (status_code, next_attempt_at);
CREATE INDEX email_messages_resource_idx ON email_messages (resource_type_code, resource_id);
CREATE INDEX email_messages_created_idx ON email_messages (created_at DESC);

-- Whether a notification has also gone out by email. Everything that existed
-- before email was switched on is marked SKIPPED, so nobody is sent a
-- backlog of old news the first time it runs.
ALTER TABLE user_notifications
  ADD COLUMN IF NOT EXISTS email_status_code text,
  ADD COLUMN IF NOT EXISTS email_message_id uuid;
UPDATE user_notifications SET email_status_code = 'SKIPPED' WHERE email_status_code IS NULL;
CREATE INDEX IF NOT EXISTS user_notifications_email_pending_idx
  ON user_notifications (created_at) WHERE email_status_code IS NULL;
