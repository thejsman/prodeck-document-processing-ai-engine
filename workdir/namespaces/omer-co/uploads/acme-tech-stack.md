# Acme Corporation — Current Technology Stack
**Document type:** Internal technical reference
**Maintained by:** Platform Engineering
**Last updated:** January 2026

---

## Data Infrastructure

### Databases & Warehouses

| System | Version | Purpose | Host |
|---|---|---|---|
| SQL Server 2019 | 15.0.4 | Core lending data warehouse | On-prem, Dell PowerEdge R750 |
| SQL Server 2016 | 13.0.5 | Wealth management reporting | On-prem, Dell PowerEdge R640 |
| SQL Server 2012 | 11.0.7 | Legacy commercial banking (decommission target) | On-prem, HP ProLiant DL380 |
| PostgreSQL 14 | 14.10 | Operational application databases (5 instances) | VMware vSphere cluster |
| MongoDB 6.0 | 6.0.8 | CRM document store | VMware vSphere cluster |

### ETL & Orchestration

| Tool | Version | Status | Notes |
|---|---|---|---|
| Informatica PowerCenter | 9.6.1 | **Critical risk** — out of support | ~600 SSIS packages in production |
| SQL Server SSIS | 2019 | Active | Used for intra-warehouse loads |
| Apache Airflow | 2.7.3 | Pilot (ML team only) | Self-hosted on Kubernetes |
| Azure Data Factory | — | **POC only** | 3 pipelines, non-production |

### Storage

| System | Capacity | Use |
|---|---|---|
| NetApp ONTAP (NAS) | 480 TB raw | Primary on-prem storage |
| Azure Data Lake Storage Gen2 | ~12 TB | ML feature store (pilot) |
| AWS S3 | ~3 TB | Backup and archive |

---

## Cloud Footprint

Acme is in the **early stages** of cloud adoption. Current cloud usage:

- **Microsoft Azure** (primary cloud — existing EA agreement, expires June 2027)
  - Azure AD (identity, SSO for all SaaS)
  - Azure Kubernetes Service (AKS) — 3 clusters (dev/staging/prod)
  - Azure Monitor + Log Analytics — centralised logging
  - Azure Data Factory — POC only
  - Azure Databricks — 1 workspace, ML team, ~$8k/month spend

- **AWS** (secondary, minimal footprint)
  - S3 for backup
  - No compute commitment

No current cloud data warehouse (Snowflake, Synapse, Redshift) is in production.

---

## BI & Analytics

| Tool | Users | Use |
|---|---|---|
| Microsoft Power BI (Premium P1) | ~350 licensed | Primary reporting and dashboards |
| Excel | All staff | Ad-hoc analysis, month-end close extracts |
| Tableau | ~40 (wealth mgmt only) | Client-facing dashboards |
| Jupyter / Python notebooks | ~15 (ML team) | Model development |

Power BI workspaces are siloed by business unit. There are currently:
- 12 active workspaces
- ~850 published reports
- No shared semantic model (each workspace imports its own data)

---

## Application Landscape (data-relevant systems)

| System | Vendor | Integration method | Data volume |
|---|---|---|---|
| LoanIQ | Finastra | Nightly DB export to SQL Server | ~2M records/day |
| Temenos Transact | Temenos | REST API + file drop | ~500k txns/day |
| Salesforce (CRM) | Salesforce | Salesforce Connect + nightly CSV | ~50k records/week |
| Avaloq (wealth) | Avaloq | SFTP file drop (fixed-width flat files) | ~200k records/day |
| Bloomberg Terminal | Bloomberg | B-PIPE market data feed | Real-time |
| FIS Compliance | FIS | DB-level replication | Batch, daily |

---

## Development & DevOps

| Area | Tools |
|---|---|
| Version control | GitHub Enterprise (self-hosted, migrating to cloud) |
| CI/CD | Jenkins (legacy), GitHub Actions (new projects) |
| Containers | Docker, Kubernetes (AKS) |
| IaC | Terraform (partial — some infra still manual) |
| Secrets management | HashiCorp Vault |
| Monitoring | Azure Monitor, Grafana, PagerDuty |

---

## Data Engineering Team

Current headcount in the Platform Engineering / Data org:

- 1× Head of Data Platform (management, not hands-on)
- 4× Data Engineers (SQL Server heavy, limited cloud experience)
- 2× BI Developers (Power BI, DAX)
- 3× Data Scientists / ML Engineers (Python, scikit-learn, some PyTorch)
- 1× Data Governance Analyst (part-time, shared with compliance)

Skills gaps identified (internal survey, Q4 2025):
- Cloud-native data engineering (Spark, Flink, cloud data warehouses)
- dbt (only 1 engineer has production experience)
- Data catalogue tooling (Collibra licence owned, not deployed)
- DataOps / GitOps for pipelines
- Streaming / event-driven architectures

---

## Security & Compliance Context

- SOC 2 Type II certified (annual audit, last passed October 2025)
- GLBA compliance required for all customer financial data
- CCPA — California customers (~22% of retail book)
- PCI-DSS — not in scope (no card processing)
- Current PII handling: manual tagging in a shared spreadsheet, no automated scanning
- Data residency: all customer data must remain in US regions

---

## Key Pain Points (from internal tech debt register)

1. **Informatica EOL** — no vendor support since 2023, security patches unavailable
2. **No data lineage** — impact analysis for any change is manual and error-prone
3. **Metric inconsistency** — "active loan count" differs by up to 8% across BU reports
4. **Month-end bottleneck** — largest nightly SSIS job takes 6h 40m; any failure cascades
5. **ML iteration speed** — feature engineering requires DBA involvement, 2–4 week lead time
6. **Collibra shelfware** — $220k/year licence, <5% of features in use
