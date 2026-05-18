# Compliance Framework — Fintech SaaS

This document provides reusable compliance language and control mappings for fintech SaaS proposals.

---

## SOC 2 Type II

**Applicable to:** Any SaaS platform handling client financial data.

### Trust Service Criteria Coverage

| Criteria | Our Approach |
|----------|-------------|
| **CC6 – Logical & Physical Access** | Role-based access control (RBAC) with principle of least privilege. MFA enforced for all privileged accounts. Access provisioned through automated IAM workflows with quarterly review cycles. |
| **CC7 – System Operations** | Centralised log aggregation (CloudWatch / Datadog). Automated anomaly detection with defined escalation paths. Patch management SLA: critical = 24h, high = 72h. |
| **CC8 – Change Management** | All changes via pull request with mandatory peer review. Automated CI/CD with security gates (SAST, dependency scanning). Change freeze windows for quarter-end periods. |
| **CC9 – Risk Mitigation** | Annual risk assessment. Vendor security reviews for all third-party integrations. Documented business continuity and disaster recovery plans. |
| **A1 – Availability** | Multi-AZ deployment. Target uptime: 99.9% (transaction paths: 99.95%). Automated failover tested quarterly. |
| **C1 – Confidentiality** | Data classification policy. PII and financial data encrypted at rest (AES-256) and in transit (TLS 1.3 minimum). |
| **PI1 – Processing Integrity** | Idempotent transaction processing. Reconciliation checks at each processing stage. Automated alerts for anomalous transaction volumes. |

**Certification path:** Architecture designed to SOC 2 Type I readiness at launch. Type II audit typically completed 12 months post-launch. We coordinate with a preferred audit partner (A-LIGN, Drata, or client's preferred firm).

---

## PCI-DSS (Payment Card Industry Data Security Standard)

**Applicable to:** Platforms that store, process, or transmit cardholder data (CHD).

### Our Scoping Approach

We always recommend reducing PCI scope first. Where possible:
- Use a **payment processor** (Stripe, Adyen, Braintree) as the CHD custodian — we never store raw card numbers
- Use **tokenisation** at the point of capture so our systems only ever see tokens
- Scope reduction is documented and reviewed with a QSA before build starts

### Controls (SAQ A-EP / SAQ D as applicable)

| Requirement | Implementation |
|-------------|----------------|
| **Req 1 – Network Security** | Dedicated payment VPC with strict ingress/egress rules. WAF on all public endpoints. No PCI-scope systems in the same subnet as non-PCI systems. |
| **Req 2 – Secure Configuration** | Hardened AMIs / container base images. No default credentials. CIS Benchmark compliance validated via automated scanning. |
| **Req 3 – Protect CHD** | Tokenisation-first design. If card data must be temporarily stored: field-level encryption, 90-day retention maximum. |
| **Req 6 – Secure Development** | OWASP Top 10 addressed in secure coding standards. Mandatory SAST and DAST in CI pipeline. Annual third-party penetration test. |
| **Req 7 – Access Control** | Need-to-know access to CHD. All access logged and monitored. Automatic session termination after 15 minutes of inactivity in PCI zone. |
| **Req 10 – Logging & Monitoring** | Immutable audit logs for all CHD access events. Log retention: 12 months minimum (3 months immediately available). SIEM integration for real-time alerting. |
| **Req 12 – Information Security Policy** | Formal security policy documented and reviewed annually. All staff with CHD access complete security awareness training. |

---

## GDPR / Data Protection

**Applicable to:** Platforms with EU/EEA users or processing EU personal data.

### Data Mapping

We document a full data inventory as part of the engagement:
- What personal data is collected and why (legal basis)
- Where it is stored (region, service, encryption state)
- Who has access (internal roles, third parties)
- How long it is retained

### Key Technical Controls

| Requirement | Implementation |
|-------------|----------------|
| **Data minimisation** | Collect only what is necessary for the stated purpose. Automated data quality checks flag unnecessary field collection. |
| **Right to erasure** | Soft-delete architecture with hard-delete pipeline. PII fields isolated to facilitate targeted erasure without data integrity loss. |
| **Data portability** | Export API for user data in machine-readable format (JSON / CSV). |
| **Breach notification** | Incident response runbook includes GDPR 72-hour notification SLA. DPA templates pre-approved with legal counsel. |
| **Data residency** | EU data stored in EU regions (e.g. eu-west-1, eu-central-1). Cross-region replication for non-EU data only with explicit DPA. |
| **Processor agreements** | DPAs executed with all sub-processors (AWS, Stripe, Datadog, etc.) before go-live. |

---

## General Security Controls (All Engagements)

### Encryption
- **At rest:** AES-256 via AWS KMS or equivalent. Customer-managed keys (CMK) for Enterprise tier.
- **In transit:** TLS 1.3 minimum. TLS 1.0/1.1 disabled. HSTS enforced.
- **Secrets management:** AWS Secrets Manager or HashiCorp Vault. No secrets in source code, environment variables, or logs.

### Identity & Access
- **Authentication:** Auth0, AWS Cognito, or client's existing IdP. SAML 2.0 / OIDC for enterprise SSO.
- **MFA:** Required for all privileged access and all admin functions.
- **Service accounts:** Non-interactive, scoped to minimum required permissions, rotated quarterly.

### Vulnerability Management
- **SAST:** Semgrep or SonarQube in CI pipeline — blocks merge on high/critical findings.
- **Dependency scanning:** Dependabot or Snyk — auto-PR for critical CVEs.
- **DAST:** OWASP ZAP against staging environment on every release.
- **Penetration testing:** Annual third-party pen test. Critical findings resolved within 30 days.

### Incident Response
- **Runbook:** Documented incident classification (P0–P3), escalation path, and communication templates.
- **On-call:** PagerDuty rotation. P0 response time: 15 minutes. P1: 1 hour.
- **Post-mortems:** Blameless post-mortem for all P0/P1 incidents. Root cause and action items tracked.
