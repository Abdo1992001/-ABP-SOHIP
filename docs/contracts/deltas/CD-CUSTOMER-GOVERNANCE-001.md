# CD-CUSTOMER-GOVERNANCE-001

## Locked implementation decisions

- An Account owner or a Sales Manager may create and revoke an explicit
  Customer Share. Country Scope remains the first mandatory filter; a share
  never widens it and an explicit deny always wins.
- Ownership transfer is optional. It requires no reason, but emits an
  auditable notification. Sharing is a supported alternative to transfer.
- Duplicate merge requires a Sales Manager approval; no merge executes through
  an ordinary edit operation.
- Group/network membership is import-governed in this phase. Sales Support has
  no manual membership authority.
- Sales Support may receive separately granted import/export permissions and
  read-only quotation/logistics projections. These permissions do not grant
  quotation/logistics mutation, Customer Share, Merge, or Group Membership.

## Typed permissions introduced

- `accounts.share`
- `accounts.merge`
- `accounts.merge.approve`
- `imports.manage`
