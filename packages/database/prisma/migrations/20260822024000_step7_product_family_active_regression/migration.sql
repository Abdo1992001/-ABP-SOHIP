-- Step-6 physical-schema regression repair discovered by the Step-7 Pricing proof.
-- ProductFamily.active is an already-approved Prisma/Step-5 field; preserve data
-- with a safe forward-only default for legacy rows.
ALTER TABLE product_families
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
