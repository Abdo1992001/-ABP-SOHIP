ALTER TABLE "quotations" ADD COLUMN "document_type_code" TEXT NOT NULL DEFAULT 'QUOTATION';
ALTER TABLE "quotations" ADD COLUMN "incoterm_code" TEXT;

ALTER TABLE "quotations" ADD CONSTRAINT "quotations_document_type_check" CHECK ("document_type_code" IN ('QUOTATION', 'PROFORMA_INVOICE'));
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_incoterm_check" CHECK ("incoterm_code" IS NULL OR "incoterm_code" IN ('DDP', 'CIF', 'FOB'));
