-- Let a conversation belong to a record.
--
-- The table already carried business_context_type / business_context_id, but
-- the type check only admitted DM and GROUP, so the only conversation the
-- system could hold was one between named people. The negotiation over a
-- deal is not that: it belongs to the deal, its readers are whoever may open
-- the record, and its membership changes as the deal is handed around.

ALTER TABLE conversations DROP CONSTRAINT conversations_type_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_type_check
  CHECK (type_code = ANY (ARRAY['DM'::text, 'GROUP'::text, 'RECORD'::text]));

-- A RECORD conversation is always addressed by what it is about, never by id,
-- so that lookup must not be a sequential scan, and there is exactly one
-- thread per record. A DM or group leaves both columns null, and Postgres
-- treats nulls in a unique index as distinct, so they are unaffected.
CREATE UNIQUE INDEX conversations_business_context_key
  ON conversations (business_context_type, business_context_id);
