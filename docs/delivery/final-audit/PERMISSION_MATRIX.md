# Permission and Scope Matrix

| Boundary                     | Evidence                                     | Status                               |
| ---------------------------- | -------------------------------------------- | ------------------------------------ |
| Authentication/principal     | local authenticated session and API guards   | IMPLEMENTED                          |
| Role/entity permission       | operation-specific permission codes          | IMPLEMENTED                          |
| Country scope before sharing | governed policy surface                      | PARTIAL; adversarial run pending     |
| Owner/manager/explicit share | policy model and row checks                  | PARTIAL; cross-user evidence pending |
| Field-level omission         | DTO/policy surface                           | PARTIAL; sensitive fixtures pending  |
| Workflow/row version         | command permissions and concurrency          | IMPLEMENTED                          |
| View As                      | preview design, no elevation intended        | NOT EXECUTED                         |
| Portal binding               | explicit identity/customer binding endpoints | PARTIAL; no local identities         |

Required negative tests not yet accepted: customer/message/portal IDOR, country scope, ownership, sharing, finance/logistics isolation, field-level omission and unauthorized export.
