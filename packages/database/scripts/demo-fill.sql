-- Demo data for the screens that render correctly but had nothing to render.
--
-- Every table filled here was empty while the screen that reads it was
-- finished and wired: contacts with no email, twenty shipments with no
-- milestones, payments that were never allocated to anything. A reviewer
-- opening those screens sees an empty state and cannot tell it apart from a
-- broken one, which is the worst possible outcome for a screen that works.
--
-- Idempotent throughout: every insert is guarded, so running it twice changes
-- nothing. It only ever adds rows — it never updates or deletes existing data,
-- so it is safe against a database that already has real work in it.
--
--   docker exec -i abp-commercial-system-db-1 psql -U abp -d abp -v ON_ERROR_STOP=1 < demo-fill.sql

\set ON_ERROR_STOP on
begin;

-- The actor every generated row is attributed to. Using a real user rather
-- than a null keeps the audit columns honest and the foreign keys satisfied.
create temporary table _actor on commit drop as
select id as user_id from app_users where active order by created_at limit 1;

-- ---------------------------------------------------------------------------
-- 1. Contact channels — an email to send documents to.
-- ---------------------------------------------------------------------------
insert into contact_channels (
  contact_channel_id, contact_id, channel_type_code, value,
  normalized_value, is_primary, created_by_user_id
)
select
  gen_random_uuid(),
  c.contact_id,
  'EMAIL',
  k.value,
  lower(k.value),
  true,
  (select user_id from _actor)
from (
  select
    contact_id,
    display_name,
    row_number() over (order by created_at, contact_id) as n
  from contacts
) c
cross join lateral (
  values
    (coalesce(nullif(lower(regexp_replace(split_part(c.display_name, ' ', 1), '[^a-zA-Z]', '', 'g')), ''), 'contact')
       || '.' || c.n || '@example-customer.com')
) as k(value)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Shipment milestones — twenty shipments, and the detail screen promised
--    "milestone by milestone" over an empty list.
--
--    The stages are the four the shipments themselves already use, not an
--    invented vocabulary, and each shipment is given the history up to where
--    it has actually got to and no further. A container still at sea that
--    reports having been delivered is worse than no history at all.
-- ---------------------------------------------------------------------------
insert into shipment_milestone_events (
  shipment_milestone_event_id, shipment_id, event_type_code,
  from_milestone_code, to_milestone_code, business_occurred_at,
  actor_user_id, new_snapshot_jsonb
)
select
  gen_random_uuid(),
  s.shipment_id,
  'MILESTONE',
  m.from_code,
  m.to_code,
  coalesce(s.bl_date::timestamptz, s.created_at)
    + ((m.step - 1) * 6 || ' days')::interval,
  (select user_id from _actor),
  jsonb_build_object('milestoneCode', m.to_code, 'source', 'DEMO_BACKFILL')
from shipments s
join lateral (
  select * from (values
    (1, null,                           'SHIPPED'),
    (2, 'SHIPPED',                      'VESSEL_DEPARTED'),
    (3, 'VESSEL_DEPARTED',              'ARRIVED_AT_PORT_OF_DISCHARGE'),
    (4, 'ARRIVED_AT_PORT_OF_DISCHARGE', 'READY_FOR_DELIVERY')
  ) as v(step, from_code, to_code)
) m on m.step <= (
  case s.milestone_code
    when 'SHIPPED' then 1
    when 'VESSEL_DEPARTED' then 2
    when 'ARRIVED_AT_PORT_OF_DISCHARGE' then 3
    when 'READY_FOR_DELIVERY' then 4
    else 1
  end
)
where not exists (
  select 1 from shipment_milestone_events e where e.shipment_id = s.shipment_id
);

-- ---------------------------------------------------------------------------
-- 3. Payment allocations — twenty payments, none of them attached to an
--    order, so "where did this money go" had no answer.
-- ---------------------------------------------------------------------------
insert into payment_allocations (
  payment_allocation_id, payment_id, sales_order_id,
  allocated_amount, reason, created_by_user_id
)
select
  gen_random_uuid(),
  p.payment_id,
  o.erp_order_id,
  -- Most payments settle an order in full; one in four is a part payment, so
  -- the screen has to show an unallocated remainder somewhere.
  case when p.n % 4 = 0 then round(p.amount * 0.6, 4) else p.amount end,
  case when p.n % 4 = 0 then 'PART_PAYMENT' else 'FULL_SETTLEMENT' end,
  (select user_id from _actor)
from (
  select payment_id, amount, account_id,
         row_number() over (order by created_at, payment_id) as n
  from payments
) p
join lateral (
  select erp_order_id from erp_orders eo
  where eo.account_id = p.account_id
  order by eo.imported_at
  limit 1
) o on true
where not exists (
  select 1 from payment_allocations a where a.payment_id = p.payment_id
);

-- ---------------------------------------------------------------------------
-- 4. Customer segments — the admin screen edits them and the pricing rules
--    read them; there were none to edit or read.
-- ---------------------------------------------------------------------------
insert into customer_segment_definitions (
  customer_segment_id, segment_code, display_name_en, display_name_ar,
  status_code, created_by_user_id
)
select gen_random_uuid(), v.code, v.en, v.ar, 'ACTIVE', (select user_id from _actor)
from (values
  ('KEY_ACCOUNT',  'Key account',       'حساب رئيسي'),
  ('CONTRACTOR',   'Contractor',        'مقاول'),
  ('RENTAL',       'Rental company',    'شركة تأجير'),
  ('EXPORT',       'Export',            'تصدير'),
  ('NEW_BUSINESS', 'New business',      'عميل جديد')
) as v(code, en, ar)
where not exists (
  select 1 from customer_segment_definitions d where d.segment_code = v.code
);

insert into customer_segment_assignments (
  customer_segment_assignment_id, account_id, customer_segment_id,
  effective_from, source_code, created_by_user_id
)
select
  gen_random_uuid(),
  a.account_id,
  d.customer_segment_id,
  a.created_at,
  'MANUAL',
  (select user_id from _actor)
from (
  select account_id, created_at,
         row_number() over (order by created_at, account_id) as n
  from accounts
) a
join lateral (
  select customer_segment_id from customer_segment_definitions
  order by segment_code
  offset (a.n % 5) limit 1
) d on true
where not exists (
  select 1 from customer_segment_assignments s where s.account_id = a.account_id
);

-- ---------------------------------------------------------------------------
-- 5. Cheques — a finance screen with a heading and nothing under it.
-- ---------------------------------------------------------------------------
insert into cheques (
  cheque_id, source_system_code, source_cheque_key, payment_id, account_id,
  cheque_number, amount, currency_code, due_on, status_code, bank_name,
  issue_date, deposited_at, cleared_at, created_by_user_id
)
select
  gen_random_uuid(),
  'MANUAL',
  'DEMO-CHQ-' || p.n,
  p.payment_id,
  p.account_id,
  '000' || lpad((100000 + p.n * 37)::text, 6, '0'),
  round(p.amount * 0.5, 4),
  p.currency_code,
  (p.created_at + ((15 + p.n * 5) || ' days')::interval)::date,
  -- Four states, including a bounced one. A register that is all one status
  -- never shows whether the screen can tell them apart, and a bounced cheque
  -- is the row a credit controller is actually looking for.
  case p.n % 4
    when 0 then 'CLEARED'
    when 1 then 'DEPOSITED'
    when 2 then 'RECEIVED'
    else 'BOUNCED'
  end,
  case p.n % 4
    when 0 then 'National Bank of Egypt'
    when 1 then 'Banque Misr'
    when 2 then 'CIB'
    else 'QNB Alahli'
  end,
  p.created_at::date,
  case when p.n % 4 in (0, 1, 3) then p.created_at + interval '2 days' end,
  case when p.n % 4 = 0 then p.created_at + interval '9 days' end,
  (select user_id from _actor)
from (
  select payment_id, account_id, amount, currency_code, created_at,
         row_number() over (order by created_at, payment_id) as n
  from payments
) p
where p.n <= 12
and not exists (
  select 1 from cheques c where c.source_cheque_key = 'DEMO-CHQ-' || p.n
);

-- ---------------------------------------------------------------------------
-- 6. Document templates — the screen that decides what the customer receives
--    had nothing to show and no way to demonstrate versioning.
-- ---------------------------------------------------------------------------
insert into document_templates (
  document_template_id, code, name, document_type_code, language_code,
  brand_code, status_code, created_by_user_id, updated_at
)
select gen_random_uuid(), v.code, v.name, v.doc_type, v.lang, 'ACROW',
       'ACTIVE', (select user_id from _actor), now()
from (values
  ('QUOTATION_EN', 'Quotation (English)', 'QUOTATION', 'en'),
  ('QUOTATION_AR', 'Quotation (Arabic)',  'QUOTATION', 'ar'),
  ('PI_EN',        'Proforma invoice',    'PROFORMA',  'en'),
  ('CONTRACT_EN',  'Supply contract',     'CONTRACT',  'en')
) as v(code, name, doc_type, lang)
where not exists (
  select 1 from document_templates t where t.code = v.code
);

insert into document_template_versions (
  document_template_version_id, template_id, version_no, status_code,
  content, content_hash, language_code, brand_code,
  created_by_user_id, updated_at, activated_by_user_id, activated_at
)
select
  gen_random_uuid(),
  t.document_template_id,
  v.version_no,
  v.status_code,
  '<!-- ' || t.code || ' v' || v.version_no || ' -->' || E'\n'
    || '<h1>{{document.title}}</h1>' || E'\n'
    || '<p>{{account.canonicalName}} — {{quotation.quotationRef}}</p>' || E'\n'
    || '<table>{{#lines}}<tr><td>{{description}}</td><td>{{lineTotal}}</td></tr>{{/lines}}</table>',
  md5(t.code || v.version_no::text),
  t.language_code,
  t.brand_code,
  (select user_id from _actor),
  now(),
  case when v.status_code = 'ACTIVE' then (select user_id from _actor) end,
  case when v.status_code = 'ACTIVE' then now() end
from document_templates t
cross join (values (1, 'ARCHIVED'), (2, 'ACTIVE')) as v(version_no, status_code)
where not exists (
  select 1 from document_template_versions dv
  where dv.template_id = t.document_template_id
);

-- ---------------------------------------------------------------------------
-- 7. Reconciliation — the screen asks "does the CRM still agree with the
--    ERP", which needs at least one run to have been answered.
-- ---------------------------------------------------------------------------
insert into reconciliation_runs (
  reconciliation_run_id, status_code, summary_jsonb, started_at, finished_at,
  reconciliation_type_code, created_by_user_id
)
select
  gen_random_uuid(),
  'COMPLETED',
  jsonb_build_object(
    'comparedCount', 809, 'matchedCount', 803,
    'mismatchCount', 4, 'missingCount', 2
  ),
  now() - interval '2 days',
  now() - interval '2 days' + interval '96 seconds',
  'ERP_ORDERS',
  (select user_id from _actor)
where not exists (select 1 from reconciliation_runs);

insert into reconciliation_issues (
  reconciliation_issue_id, run_id, issue_code, severity_code, source_key,
  resource_type_code, resource_id, details_jsonb, status_code
)
select
  gen_random_uuid(),
  r.reconciliation_run_id,
  i.issue_code,
  i.severity_code,
  o.source_order_key,
  'ERP_ORDER',
  o.erp_order_id,
  jsonb_build_object('field', i.field, 'crm', i.crm_value, 'erp', i.erp_value),
  'OPEN'
from (select reconciliation_run_id from reconciliation_runs order by created_at limit 1) r
cross join lateral (
  select erp_order_id, source_order_key,
         row_number() over (order by imported_at, erp_order_id) as n
  from erp_orders limit 6
) o
join lateral (
  select * from (values
    (1, 'AMOUNT_MISMATCH',   'HIGH',   'totalAmount',  '128400.00', '128040.00'),
    (2, 'AMOUNT_MISMATCH',   'HIGH',   'totalAmount',  '64200.00',  '64020.00'),
    (3, 'STATUS_MISMATCH',   'MEDIUM', 'statusCode',   'CONFIRMED', 'DRAFT'),
    (4, 'STATUS_MISMATCH',   'MEDIUM', 'statusCode',   'SHIPPED',   'CONFIRMED'),
    (5, 'MISSING_IN_CRM',    'LOW',    'orderRef',     null,        'present'),
    (6, 'MISSING_IN_CRM',    'LOW',    'orderRef',     null,        'present')
  ) as t(n, issue_code, severity_code, field, crm_value, erp_value)
) i on i.n = o.n
where not exists (select 1 from reconciliation_issues);

-- ---------------------------------------------------------------------------
-- 8. Pricing guardrails — the policy screen's floor-and-ceiling half was
--    empty, so a quotation could never demonstrate hitting a limit.
-- ---------------------------------------------------------------------------
insert into pricing_guardrails (
  pricing_guardrail_id, product_family_id, min_price, reference_price,
  max_price, currency_code, effective_from, created_by_user_id
)
select
  gen_random_uuid(),
  f.product_family_id,
  1800.0000,
  2400.0000,
  3600.0000,
  'EGP',
  now() - interval '90 days',
  (select user_id from _actor)
from product_families f
where not exists (
  select 1 from pricing_guardrails g
  where g.product_family_id = f.product_family_id
);

-- ---------------------------------------------------------------------------
-- 9. Quotation adjustments — the discount mechanism the totals already run
--    through, never once exercised, so no quotation showed a discount line.
-- ---------------------------------------------------------------------------
insert into quotation_adjustments (
  quotation_adjustment_id, quotation_id, type_code, mode_code, value, label
)
select
  gen_random_uuid(),
  q.quotation_id,
  'DISCOUNT',
  case when q.n % 2 = 0 then 'PERCENT' else 'FIXED_AMOUNT' end,
  case when q.n % 2 = 0 then 2.5000 else 5000.0000 end,
  case when q.n % 2 = 0 then 'Volume discount' else 'Settlement discount' end
from (
  select quotation_id, row_number() over (order by created_at) as n
  from quotations
  -- A sent quotation's children are immutable by trigger, and rightly so:
  -- a discount cannot appear on a document the customer already has.
  where sent_at is null
) q
where q.n <= 5
and not exists (
  select 1 from quotation_adjustments a where a.quotation_id = q.quotation_id
);

commit;

-- What the fill produced, so the run reports itself rather than being trusted.
select 'contact_channels' t, count(*) from contact_channels
union all select 'shipment_milestone_events', count(*) from shipment_milestone_events
union all select 'payment_allocations', count(*) from payment_allocations
union all select 'customer_segment_definitions', count(*) from customer_segment_definitions
union all select 'customer_segment_assignments', count(*) from customer_segment_assignments
union all select 'cheques', count(*) from cheques
union all select 'document_templates', count(*) from document_templates
union all select 'document_template_versions', count(*) from document_template_versions
union all select 'reconciliation_runs', count(*) from reconciliation_runs
union all select 'reconciliation_issues', count(*) from reconciliation_issues
union all select 'pricing_guardrails', count(*) from pricing_guardrails
union all select 'quotation_adjustments', count(*) from quotation_adjustments
order by 1;
