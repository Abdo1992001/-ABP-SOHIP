# Step 11 disaster recovery design

Primary is UAE North. The architecture uses PostgreSQL PITR/geo backup, versioned private Blob storage, immutable image digests, reproducible Bicep, and a warm-deployable Container Apps topology. Engineering objectives are RPO ≤15 minutes and RTO ≤4 hours.

UAE Central is the intended DR region but is `PENDING DEP-003`: malware-scanning parity is not assumed. Before RG-09, governance must approve either a supported-region scanning fallback or an alternate supported DR region. A DR test must restore PostgreSQL and objects into isolated private resources, deploy the same digests, validate Entra/WAF/Key Vault/telemetry, reconcile business counts, and measure RPO/RTO. No live failover is claimed by Step 11.
