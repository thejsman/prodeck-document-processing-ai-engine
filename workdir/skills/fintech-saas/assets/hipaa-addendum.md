# HIPAA Compliance Addendum — Healthcare-Adjacent Fintech

This addendum applies when the client operates in healthcare fintech: health savings accounts (HSAs/FSAs), medical payment processing, insurance claims, or any platform that handles Protected Health Information (PHI) alongside financial data.

---

## Scope Determination

Before applying HIPAA controls, confirm whether the platform is a **Covered Entity** or **Business Associate**:

| Role | Example | Obligation |
|------|---------|------------|
| **Covered Entity** | A health plan processing premium payments | Full HIPAA compliance required |
| **Business Associate** | A payment processor used by a hospital | BAA required + Security Rule compliance |
| **Subcontractor BA** | A cloud provider used by the payment processor | BAA with the BA required |

We always execute a **Business Associate Agreement (BAA)** with any client whose platform may encounter PHI, regardless of the scope determination. BAA templates are available pre-approved by legal counsel.

---

## Technical Safeguards (45 CFR § 164.312)

### Access Control
- **Unique user identification:** Every user and service account has a unique, non-shared identifier. No shared credentials under any circumstances.
- **Emergency access procedure:** Break-glass accounts documented, time-limited, and audited. Access triggers automatic alert to security team.
- **Automatic logoff:** Sessions in PHI-adjacent interfaces terminate after 15 minutes of inactivity.
- **Encryption & decryption:** PHI fields are encrypted at rest using AES-256 with customer-managed keys (AWS KMS CMK). Encryption keys are rotated annually or on personnel change.

### Audit Controls
- **Immutable audit logs:** Every read, write, and delete event touching PHI is logged to an append-only log store. Logs cannot be modified or deleted by application users.
- **Log retention:** PHI access logs retained for 6 years minimum (HIPAA requirement), stored in cost-optimised cold storage after 90 days.
- **Audit log review:** Automated anomaly detection flags unusual access patterns (bulk export, access outside business hours, new IP geolocation).

### Integrity Controls
- **Data integrity verification:** Checksums on PHI records. Automated alerts on unexpected modification.
- **Transmission integrity:** TLS 1.3 minimum for all PHI transmission. MTLS for service-to-service communication in the PHI processing path.

### Transmission Security
- **Encryption in transit:** All PHI transmitted over public networks uses TLS 1.3. No PHI over unencrypted channels under any circumstances.
- **VPN for administrative access:** Administrative access to PHI systems via VPN + MFA only, never direct public internet.

---

## Administrative Safeguards (45 CFR § 164.308)

### Security Officer
A named Security Officer is designated on the engagement with responsibility for HIPAA compliance oversight. Contact and escalation path is documented in the runbook.

### Workforce Training
All engineers with access to PHI systems complete HIPAA security awareness training before being granted access. Training records maintained and renewed annually.

### Access Management
- Access to PHI systems follows a formal provisioning workflow with manager approval.
- Access is reviewed quarterly. Terminated employees are deprovisioned within 4 hours of separation.
- Minimum necessary standard enforced: access is scoped to the minimum PHI required for the user's role.

### Incident Response
HIPAA breach notification requirements are built into the incident response runbook:
- **Discovery to containment:** 4-hour target.
- **Internal escalation:** Security Officer notified within 1 hour of discovery.
- **Breach assessment:** Formal assessment completed within 24 hours using the four-factor test (nature/extent of PHI, likelihood of identification, whether PHI was actually acquired, mitigation taken).
- **Notification to Covered Entity:** Within 60 days of discovery if breach is confirmed.
- **HHS notification:** Managed by Covered Entity. We provide all necessary evidence and documentation within 5 business days of request.

---

## Physical Safeguards (45 CFR § 164.310)

All PHI is processed and stored in AWS, GCP, or Azure data centres with ISO 27001 certification and HIPAA-eligible service agreements. We do not operate physical data centres. Cloud provider BAAs are executed before any PHI processing begins.

Workstation controls for remote engineers:
- Full-disk encryption mandatory on all development machines.
- No PHI in local development environments — all development uses synthetic/anonymised data.
- Screen lock enforced after 5 minutes of inactivity.

---

## Data Minimisation for Healthcare Fintech

We apply PHI minimisation at the design stage:
- **Tokenise PHI where possible:** Replace PHI with non-PHI tokens for processing steps that don't require the actual data (e.g. payment routing doesn't need the diagnosis code).
- **Segregate PHI from financial data:** PHI and financial records stored in separate, independently encrypted data stores with separate access control policies.
- **Synthetic data in non-production:** All development, QA, and load testing uses synthetically generated data. Production PHI never copied to lower environments.

---

## HIPAA-Specific Architecture Diagram Points

When describing the architecture for a HIPAA-adjacent engagement, ensure the proposal covers:

1. **PHI data flow diagram** — where PHI enters the system, how it moves, where it exits
2. **Trust boundary diagram** — clear delineation of HIPAA-in-scope vs out-of-scope components
3. **Encryption at rest diagram** — which data stores, which encryption keys, who manages them
4. **Access control matrix** — which roles can read/write/delete PHI, under what conditions
