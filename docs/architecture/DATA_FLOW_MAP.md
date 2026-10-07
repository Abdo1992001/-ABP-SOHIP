# Self-Hosted Data Flow Map

Every command follows: **input → validation → authorization → business rule → database transaction → audit → notification/job → output**.

| Workflow                 | Canonical path                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Create Customer          | DTO validation → country/permission scope → account transaction → audit → notification → account 360 ID                               |
| Change Opportunity Stage | stage DTO → ownership/country/workflow permission → opportunity transaction; WON creates immutable snapshot → audit/analytics refresh |
| Opportunity WON          | validate value/currency/customer → snapshot customer/country/segment/owner → target analytics reads snapshot only                     |
| Create Quotation         | customer/project/opportunity/product IDs → pricing rules → line/total transaction → audit → draft output                              |
| Send Quotation           | immutable snapshot + server PDF → local document hash/storage → sent audit/job → optional SMTP only if configured                     |
| ERP Import               | upload to protected storage → detect/map → identity/DQ validation → review/commit transaction → reconciliation/audit                  |
| Smart Import             | local XLSX/CSV/JSON parse → alias/confidence/required-field checks → reviewed commit → import audit                                   |
| Customer Sharing         | validate recipient and country scope first → explicit share transaction → audit → notification                                        |
| Message Send             | business-context authorization → message transaction → unread notification; no global private-message search                          |
| Portal Complaint         | explicit LAN customer binding → DTO validation → complaint transaction → audit → notification                                         |
| Returned Scrap           | finance/returns permission → quantity/product/order validation → transaction → audit → reconciliation                                 |

No flow requires public Internet. External SMTP, ERP API, calendar connectors or public research are optional adapters and must fail gracefully.
