# Fintech Case Studies

---

## Case Study 1: Payment Orchestration Platform — Series B Payments Startup

**Client:** A Series B payments startup (confidential) processing B2B invoice payments across the US and Canada.

**The Problem**

The client had outgrown their legacy monolith: transaction failures during peak periods were running at 2.3%, manual reconciliation was consuming 80 person-hours per week, and two enterprise contracts were blocked at security review because the platform lacked SOC 2 documentation. They had 6 months before a Series C fundraise and needed both the tech and the compliance story in place.

**Our Approach**

We ran a 22-week Scale engagement:

- **Weeks 1–4 (Foundation):** Extracted the transaction processing core from the monolith into an event-driven microservice (Kafka + Node.js). Established the new infrastructure on AWS with multi-AZ RDS PostgreSQL and immutable CloudWatch logs.
- **Weeks 5–14 (Core Build):** Re-built the reconciliation engine with idempotent processing and automated mismatch detection. Integrated with Stripe Connect (US) and Stripe Treasury (CA). Built the SOC 2 evidence collection pipeline alongside feature development — not as an afterthought.
- **Weeks 15–20 (Compliance & Hardening):** Worked with A-LIGN to prepare the SOC 2 Type I report. Ran penetration testing and resolved 3 medium-severity findings. Load tested to 10x current peak volume.
- **Weeks 21–22 (Launch & Handover):** Phased traffic migration. Zero-downtime cutover. Runbook and on-call documentation delivered.

**Outcome**

- Transaction failure rate: **2.3% → 0.04%** (industry benchmark: <0.1%)
- Reconciliation time: **80 hours/week → 6 hours/week** — $340k/year in ops savings
- SOC 2 Type I report delivered at launch, Type II 11 months later
- Both blocked enterprise contracts closed within 90 days of SOC 2 Type I. Combined ARR: $2.1M
- Platform handled **12x traffic** on Black Friday with zero incidents

---

## Case Study 2: Lending SaaS Platform — RegTech Startup

**Client:** An early-stage RegTech company building a white-label lending platform for community banks and credit unions.

**The Problem**

The client was building a platform that would be sold to regulated financial institutions — meaning every customer would require their own security review and potentially their own penetration test. The technical and compliance bar was unusually high for a seed-stage company. They needed an architecture that could pass a Tier 1 bank's vendor assessment on day one.

**Our Approach**

We ran a 14-week MVP engagement with a heavy compliance focus:

- **Architecture-first design:** Three-week discovery and design sprint with the client's CTO and a compliance advisor. Produced a formal architecture decision record (ADR) covering data residency, access control model, and encryption strategy before a line of code was written.
- **Tenant isolation:** Multi-tenant architecture with strict logical data isolation per bank customer. Row-level security in PostgreSQL. Each tenant's encryption keys managed separately via AWS KMS.
- **Compliance-native build:** SOC 2 trust service criteria were mapped to code before development began. Every control had an owner, an evidence artifact, and a test.
- **Vendor assessment support:** Produced a 40-page security questionnaire response template and an architecture overview document formatted for bank IT risk teams.

**Outcome**

- Platform passed vendor security assessments at **3 community banks within 60 days of launch** (typical timeline for a new vendor: 6–18 months)
- First paying customer (a $2B AUM credit union) signed within 5 weeks of passing vendor review
- Seed round closed at $4.2M, with the "compliance-native architecture" called out explicitly in the investor memo as a differentiator
- Zero security incidents in 18 months post-launch

---

## Case Study 3: Insurance Payment Processing — InsurTech Platform

**Client:** An InsurTech company automating premium collection and claims disbursement for P&C insurance carriers.

**The Problem**

The client needed to connect with 12 insurance carriers (each with different APIs and data formats), process premium payments compliantly, and disburse claims to policyholders via ACH and push-to-debit — all while meeting state insurance regulatory requirements across 50 US jurisdictions.

**Our Approach**

18-week Scale engagement focused on integration architecture and state-level compliance:

- Built an **integration abstraction layer** that normalised 12 carrier APIs into a single internal schema. Adding a new carrier became a configuration task, not an engineering task.
- Implemented **Dwolla** for ACH disbursements and **Marqeta** for push-to-debit, with Plaid for bank account verification.
- Built a **compliance rules engine** that evaluated each transaction against the regulatory requirements for the relevant state. Rules were managed by the client's compliance team via a configuration interface, not code.
- Produced a **state compliance matrix** mapping all 50 states' premium payment and claims disbursement rules, updated quarterly.

**Outcome**

- **12 carrier integrations** delivered on time
- **$47M in premiums processed** in the first 12 months
- Compliance rules engine blocked **3 regulatory violations** that would have resulted in state fines
- Platform expansion to 2 new carriers took **3 days** vs. an estimated 6 weeks without the abstraction layer
- Client raised a $22M Series A 8 months after launch, citing the "carrier-agnostic architecture" as a strategic asset
