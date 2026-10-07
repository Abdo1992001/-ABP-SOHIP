DO $$ BEGIN
  ALTER TABLE quotation_approvals
    ADD CONSTRAINT quotation_approvals_quotation_fk
    FOREIGN KEY (quotation_id) REFERENCES quotations(quotation_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
