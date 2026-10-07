-- Give an opportunity a name.
--
-- Until now a deal carried a reference (OPP-00000007), a customer, a stage and
-- a value, but nothing anyone could read. A sales manager scanning the pipeline
-- saw a column of reference numbers, and searching for the Cairo tower job was
-- impossible because no text described it. Every other CRM object in this
-- system has a human name -- an account has canonical_name, a project has a
-- name, a contact has display_name -- and the opportunity was the exception.

ALTER TABLE opportunities ADD COLUMN title text;

-- Backfill so no existing row is nameless. The project it belongs to is the
-- closest thing to a name the record already holds; otherwise the customer and
-- the stage it is sitting in. These are provisional by construction -- a real
-- one gets typed the next time someone edits the deal.
UPDATE opportunities o
SET title = COALESCE(
  (SELECT p.name FROM projects p WHERE p.project_id = o.project_id),
  (SELECT a.canonical_name FROM accounts a WHERE a.account_id = o.account_id)
    || ' — ' || replace(initcap(replace(o.stage_code, '_', ' ')), ' ', ' ')
)
WHERE o.title IS NULL;

-- Searching the pipeline by name is the reason the column exists.
CREATE INDEX opportunities_title_idx ON opportunities (title);
