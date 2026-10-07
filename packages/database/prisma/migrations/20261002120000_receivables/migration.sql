-- Receivables: what each customer order still owes, installment by installment.
--
-- The plan comes from the payment schedule the customer accepted on the
-- quotation (advance + post-dated cheques, or one full payment when the
-- quotation had no schedule). It is written when the order is confirmed. An
-- advance is due on confirmation; a "N days after delivery" installment has no
-- date until the order is handed over, and gets one then -- an installment
-- whose clock has not started is not overdue, and showing it as due would make
-- the aging report lie.
--
-- Collections are real payments: recording one writes a row to payments (so
-- the payments screen and its reports see it) and a receipt that ties that
-- payment to the installment it settles.

CREATE TABLE IF NOT EXISTS receivable_installments (
  receivable_installment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_order_id uuid NOT NULL REFERENCES customer_orders(customer_order_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  country_code character(2) NOT NULL,
  currency_code character(3) NOT NULL,
  installment_no integer NOT NULL CHECK (installment_no >= 1),
  label text NOT NULL,
  stage_code text NOT NULL CHECK (stage_code IN ('ADVANCE', 'INSTALLMENT', 'FULL')),
  due_basis_code text NOT NULL CHECK (due_basis_code IN ('BEFORE_DELIVERY', 'AFTER_HANDOVER', 'FIXED_DATE')),
  days_after integer CHECK (days_after IS NULL OR days_after >= 0),
  due_date date,
  amount numeric(18, 4) NOT NULL CHECK (amount >= 0),
  collected_amount numeric(18, 4) NOT NULL DEFAULT 0 CHECK (collected_amount >= 0),
  written_off_amount numeric(18, 4) NOT NULL DEFAULT 0 CHECK (written_off_amount >= 0),
  method_code text,
  status_code text NOT NULL DEFAULT 'OPEN'
    CHECK (status_code IN ('OPEN', 'PARTIAL', 'PAID', 'WRITTEN_OFF', 'CANCELLED')),
  write_off_reason text,
  written_off_at timestamptz(6),
  written_off_by_user_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (customer_order_id, installment_no),
  CONSTRAINT receivable_installments_settled_check
    CHECK (collected_amount + written_off_amount <= amount),
  CONSTRAINT receivable_installments_write_off_reason_check
    CHECK (written_off_amount = 0 OR NULLIF(btrim(write_off_reason), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS receivable_installments_country_status_due_idx
  ON receivable_installments(country_code, status_code, due_date);
CREATE INDEX IF NOT EXISTS receivable_installments_account_idx
  ON receivable_installments(account_id, due_date);

CREATE TABLE IF NOT EXISTS receivable_receipts (
  receivable_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_installment_id uuid NOT NULL
    REFERENCES receivable_installments(receivable_installment_id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments(payment_id) ON DELETE RESTRICT,
  amount numeric(18, 4) NOT NULL CHECK (amount > 0),
  received_on date NOT NULL,
  method_code text NOT NULL CHECK (method_code IN ('CASH', 'TRANSFER', 'CHEQUE', 'CARD', 'OTHER')),
  reference text,
  note text,
  recorded_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS receivable_receipts_installment_idx
  ON receivable_receipts(receivable_installment_id, received_on);

-- Orders already past confirmation get their plan now. Only orders without a
-- schedule exist at this point, so each owes one full payment from the day it
-- was confirmed.
INSERT INTO receivable_installments(
  customer_order_id, account_id, country_code, currency_code, installment_no,
  label, stage_code, due_basis_code, due_date, amount
)
SELECT o.customer_order_id, o.account_id, o.country_code, o.currency_code, 1,
       'Full payment', 'FULL', 'BEFORE_DELIVERY',
       COALESCE(o.confirmed_at, o.created_at)::date, o.total_amount
FROM customer_orders o
WHERE o.status_code NOT IN ('DRAFT', 'CANCELLED')
  AND jsonb_array_length(COALESCE(o.payment_schedule_jsonb -> 'rows', '[]'::jsonb)) = 0
ON CONFLICT DO NOTHING;
