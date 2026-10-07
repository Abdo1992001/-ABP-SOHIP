-- Quality gets its own role. The complaint route's quality review and the
-- work orders' quality check were granted to R&D for want of anyone else;
-- a quality engineer is a different person with a different job.
INSERT INTO roles(id, code, name, workspace, active, is_system_protected)
VALUES (gen_random_uuid(), 'QUALITY_ENGINEER', 'QUALITY ENGINEER', 'SALES', true, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.code = 'QUALITY_ENGINEER'
  AND p.code IN (
    'complaints.view', 'complaints.quality-review',
    'work-orders.view', 'work-orders.qc',
    'feedback.view', 'products.view', 'documents.view'
  )
ON CONFLICT DO NOTHING;
