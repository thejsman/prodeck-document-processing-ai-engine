# Request for Proposal (RFP)
## Enterprise Data Platform Modernisation
**Issued by:** Acme Corporation
**RFP Reference:** ACME-2026-DPM-001
**Issue Date:** 3 February 2026
**Response Deadline:** 28 February 2026
**Point of Contact:** Sarah Mitchell, VP Engineering — s.mitchell@acme-corp.com

---

## 1. Company Overview

Acme Corporation is a mid-market financial services firm headquartered in Chicago, IL, with approximately 1,200 employees across 4 US offices (Chicago, New York, Austin, San Francisco). We operate in three primary business lines:

- **Retail lending** — personal loans, auto finance, home equity lines
- **Commercial banking** — SME credit facilities, treasury management
- **Wealth management** — AUM of ~$4.2B, serving 9,000 HNW clients

Our current annual technology spend is approximately $18M. The data platform initiative has a preliminary budget envelope of **$1.2M–$1.8M** for a 12-month engagement.

---

## 2. Problem Statement

Our data infrastructure has grown organically over 14 years. We currently operate:

- 3 on-premise SQL Server data warehouses (2012, 2016, 2019 versions)
- A legacy ETL platform (Informatica PowerCenter 9.x — out of mainstream support)
- Approximately 600 SSIS packages of varying quality and documentation
- No unified data catalogue or lineage tracking
- Siloed reporting: each business unit maintains its own Power BI workspaces with overlapping, often conflicting, definitions of core metrics (e.g. "active loan" is defined differently in 4 places)

The consequences are:

- Month-end close takes 9 business days; the CFO has a stated target of 5 days
- Risk and compliance teams spend ~30% of their time on manual data reconciliation
- Regulatory reporting (CECL, DFAST stress testing) relies on ad-hoc Excel extracts
- The ML team cannot iterate models faster than 6-week data pipeline cycles

---

## 3. Scope of Work

The selected vendor is expected to deliver the following:

### 3.1 Data Platform Assessment (Phase 1 — Weeks 1–6)
- Inventory all existing data sources, pipelines, and consumers
- Identify top 20 highest-value datasets by business impact
- Produce a current-state architecture diagram and gap analysis
- Prioritised migration roadmap with effort estimates

### 3.2 Modern Data Platform Design (Phase 2 — Weeks 7–16)
- Target architecture design (cloud-native, vendor-agnostic preferred)
- Data mesh vs. centralised lakehouse evaluation with recommendation
- Governance framework: data catalogue, lineage, quality SLAs
- Security and compliance design (SOC 2, GLBA, CCPA alignment)

### 3.3 Pilot Migration (Phase 3 — Weeks 17–32)
- Migrate 3 agreed high-priority datasets end-to-end
- Deliver working CI/CD pipeline for data assets
- Integrate with existing Power BI reporting layer
- Decommission equivalent legacy SSIS packages

### 3.4 Enablement and Handover (Phase 4 — Weeks 33–48)
- Training programme for 12 internal data engineers
- Runbooks and operational documentation
- 90-day hypercare support post go-live

---

## 4. Technical Requirements

### 4.1 Mandatory
- Cloud-agnostic or multi-cloud capable architecture (we are evaluating Azure and AWS)
- Open table format support (Apache Iceberg or Delta Lake)
- Real-time and batch ingestion capability
- Column-level data lineage
- Role-based access control aligned with Active Directory groups
- SLA: 99.5% pipeline uptime for Tier-1 datasets
- All PII fields identified, masked or tokenised at ingestion

### 4.2 Preferred
- dbt as the transformation layer (our ML team already uses it for one domain)
- Integration with existing Collibra data catalogue licence (we own Enterprise tier)
- Support for Python-based custom transformations
- GitOps deployment model for pipeline changes

---

## 5. Team Expectations

We expect the vendor to provide:

- 1× Engagement Lead / Solution Architect (senior, 10+ years, FS experience)
- 2× Senior Data Engineers (cloud-native, dbt, Spark or Flink)
- 1× Data Governance Specialist
- 1× Project Manager (part-time, 0.5 FTE)

Minimum 3 days on-site per week in Chicago during Phases 1–2. Remote acceptable for Phases 3–4 with fortnightly on-site checkpoints.

---

## 6. Evaluation Criteria

Proposals will be scored as follows:

| Criterion | Weight |
|---|---|
| Technical approach and architecture quality | 35% |
| Relevant financial services experience (case studies required) | 25% |
| Team quality and CVs | 20% |
| Commercial terms and value for money | 15% |
| References (minimum 2 FS clients) | 5% |

---

## 7. Commercial Terms

- Fixed-price or time-and-materials with a cap — either model acceptable
- Payment: monthly in arrears against agreed milestones
- Penalty clause: 5% of monthly invoice if milestone deliverables are missed without prior written agreement
- IP: all custom code and documentation produced during the engagement to be transferred to Acme on completion
- NDA required before proposal submission

---

## 8. Submission Requirements

Please include in your response:

1. Executive summary (max 2 pages)
2. Proposed solution architecture with diagrams
3. Phase-by-phase delivery plan with milestones
4. CV for each named team member
5. Minimum 2 FS client case studies with quantified outcomes
6. Pricing breakdown by phase and role
7. Risk register with mitigations
8. References (name, title, email) for 2 recent FS engagements

Proposals must be submitted as PDF to rfp@acme-corp.com by 17:00 CT on 28 February 2026.
