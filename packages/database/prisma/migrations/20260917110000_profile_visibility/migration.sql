-- Let people choose what colleagues see.
--
-- Two booleans, not a three-level scope. The brief offered
-- everyone / my team / hidden, but this deployment has no teams: there is no
-- teams table and every user_profiles.team_id is null, so "visible to my team"
-- would be a setting that points at nothing. Show or hide is the simplest
-- model that is actually sufficient here.
--
-- Only genuinely optional personal information is covered. Name, role and
-- email have no switch on purpose: the directory finds colleagues by name and
-- email, and work cannot be assigned to someone whose role nobody can see.
-- Those are business identity, not preference.
--
-- Typed columns rather than keys inside the preferences blob, because these
-- have to be enforced in the queries that build the directory and the search
-- results, not just read back on the settings screen.

ALTER TABLE user_profiles
  ADD COLUMN photo_visible boolean NOT NULL DEFAULT true;

-- Visible by default: someone adds a number to an internal directory in order
-- to be reachable, and a number that silently goes nowhere is the more
-- surprising outcome. The switch sits directly under the field, so the choice
-- is in front of them as they type it.
ALTER TABLE user_profiles
  ADD COLUMN phone_visible boolean NOT NULL DEFAULT true;
