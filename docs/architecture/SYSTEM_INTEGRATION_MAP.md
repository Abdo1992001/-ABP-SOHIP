# Self-Hosted System Integration Map

```mermaid
flowchart LR
  Browser[React/Vite static web] --> Proxy[Caddy internal TLS]
  Proxy --> API[NestJS API]
  API --> Domain[Domain services + authorization]
  Domain --> PG[(PostgreSQL 17)]
  Worker[PostgreSQL-backed worker] --> PG
  Domain --> Files[Protected local storage]
  Analytics[Backend analytics] --> PG
  Engineering[Engineering Studio] --> Product[Canonical Product]
  Engineering --> Customer[Canonical Customer/Project/Opportunity]
  Quotation[Quotation Studio] --> Product
  Quotation --> Customer
  ERP[File/Mock ERP adapter] --> Staging[Staging + DQ + resolution]
  Staging --> PG
  C360[Customer 360] --> PG
  Messages[Internal messages] --> PG
  Calendar[CRM calendar] --> PG
  Portal[LAN customer portal] --> API
```

The self-hosted profile has no cloud identity, cloud database, managed queue, paid analytics, public map or hosted file store. Local SMTP is optional; internal notifications/messages/calendar remain PostgreSQL-backed. Engineering, quotation, ERP and Customer 360 must resolve stable canonical IDs and may not create mini-master data stores.
