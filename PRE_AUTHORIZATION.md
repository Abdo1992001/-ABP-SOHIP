# Pre-authorization guard

Allowed now:

- local repository and application scaffolding;
- contracts, tests, Dockerfiles, CI workflows, and Bicep templates;
- synthetic local data only;
- D9-001 contract preparation.

Not authorized now:

- claiming `IMPLEMENTATION AUTHORIZED` or `PRODUCTION READY`;
- changing RG-01 to PASS;
- production Azure/Entra provisioning;
- production identities, customer data, secrets, or integrations;
- bypassing Country Scope, authorization, malware scanning, or release evidence gates.

The canonical unsigned Baseline R1 must not be modified by this repository.
