-- Take system administration away from the sales manager.
--
-- The role was seeded with a blacklist -- every permission except `admin.` and
-- `security.` -- so it ended up holding exactly the same 134 permissions as
-- SYSTEM_ADMIN. User administration is spelled `users.`, role administration
-- `roles.`, so both went straight through the filter: a sales manager could
-- create users, grant roles, revoke sessions, change country access and edit
-- the company pricing basis.
--
-- The seed now grants by allowlist. This revokes what the old rule already
-- handed out on databases that have been seeded, so existing deployments do
-- not keep the elevation. It only deletes grants from SALES_MANAGER; no other
-- role, and no user-level grant, is touched.

DELETE FROM role_permissions rp
USING roles r
WHERE r.id = rp.role_id
  AND r.code = 'SALES_MANAGER'
  AND rp.permission_code IN (
    -- Administering people and access.
    'users.view', 'users.create', 'users.manage',
    'roles.view', 'roles.assign', 'roles.manage',
    'groups.view', 'groups.manage',
    'sessions.revoke',
    'country-access.manage',
    'security-audit.view',
    -- Setting company pricing policy, as opposed to approving a deal's price.
    'pricing.manage', 'pricing.policy.view', 'pricing.policy.manage',
    -- Acting inside another function's ledger.
    'payments.create', 'payments.allocate',
    'cheques.create', 'cheques.manage',
    'finance.fx.edit',
    'shipments.create', 'shipments.edit',
    'logistics.create', 'logistics.edit', 'logistics.export',
    'catalog.manage',
    'capacity.manage',
    'data-quality.manage',
    'imports.commit', 'imports.manage', 'imports.rollback', 'imports.source.view',
    'item-resolver.manage',
    'reconciliation.manage', 'reconciliation.run'
  );
