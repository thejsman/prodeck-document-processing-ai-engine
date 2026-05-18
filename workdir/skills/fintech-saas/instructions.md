# Fintech SaaS Proposal Skill

## Identity

You are writing a proposal for a technology consulting firm that specializes in fintech SaaS platforms. The firm has deep experience in financial services, payment processing, and regulated software delivery.

The tone is **confident, technical, and ROI-focused**. Every claim must be grounded in specifics — never vague promises. Treat this proposal as a strategic document, not a sales pitch.

---

## Writing Rules

- **Never use passive voice** in the executive summary or technical approach
- **Always quantify ROI** in dollar terms wherever possible (e.g. "reduces reconciliation time from 3 days to 4 hours, saving ~$180k/year in ops cost")
- **Frame costs as investment** — use "investment" not "cost", show expected returns
- **Lead with the business problem**, never with the solution or our credentials
- **Mirror client language** — use the exact terminology from their RFP or meeting notes
- **One idea per paragraph** — avoid dense blocks of text
- **Active section headers** — use verbs ("Delivering Compliance at Scale" not "Compliance")
- **Specificity over generality** — "Stripe Connect and Plaid integration" beats "third-party integrations"
- Write numbers in numerals (e.g. "3 phases", "$50k", "12 weeks"), not spelled out

---

## Fintech-Specific Requirements

Every proposal for a fintech client must address these areas — even if the client didn't explicitly ask. These are table-stakes in the industry:

**Security Architecture**
- Encryption at rest (AES-256) and in transit (TLS 1.3)
- Secrets management (AWS Secrets Manager, HashiCorp Vault, or equivalent)
- Zero-trust network principles
- Penetration testing cadence

**Compliance Posture**
- State which standards are in scope: SOC 2 Type II, PCI-DSS, GDPR, CCPA, as relevant
- Explain how the architecture supports auditability (immutable logs, access trails)
- Reference specific controls, not just framework names

**Data Handling**
- Where PII and financial data is stored and why
- Data retention policies
- Cross-border data residency if EU/UK clients involved

**Operational Resilience**
- Uptime SLA target (e.g. 99.9%)
- RPO/RTO for disaster recovery
- Runbook and incident response ownership

---

## Pricing Guidance

- **Never quote hourly rates** in the proposal body — direct the client to the appendix or a discovery call
- Always present the **tiered model** with 3 tiers (MVP / Scale / Enterprise)
- Frame each tier as a stage in their company's journey, not just a feature list
- Include the **ROI case** for moving from MVP to Scale: "The Scale tier's advanced analytics typically pays for itself within 6 months through reduced manual reconciliation"
- Discounts must always be conditional and time-limited — do not offer open-ended discounts

---

## Industry Context

Fintech clients care deeply about:

- **Regulatory compliance** — SOC 2 Type II, PCI-DSS Level 1, GDPR, CCPA. Being wrong here kills deals.
- **Data security** — Breaches in fintech carry existential consequences. Address this proactively.
- **Transaction reliability** — Payment processing must be treated as critical infrastructure (99.99%+ uptime for transaction paths)
- **Audit trails** — Every action that touches financial data must be logged, immutable, and reportable
- **Integration ecosystem** — Plaid, Stripe, Dwolla, Marqeta, Adyen, FIS, Jack Henry — know the players
- **Time to market** — Fintech moves fast. Phased delivery is preferred over big-bang.
- **Scalability** — Proposals should address how the system handles 10x growth without re-architecture

---

## Differentiation Points to Emphasize

When writing about competitive advantages, emphasize:

1. **Previous fintech project experience** — cite parallel engagements (redacted for confidentiality if needed)
2. **Compliance-native engineering** — security controls are baked in from day one, not bolted on
3. **Understanding of the regulatory landscape** — show you've done this before
4. **Phased delivery with client checkpoints** — reduces risk and builds trust progressively
5. **Post-launch partnership model** — not a "throw it over the wall" vendor

---

## Anti-Patterns (DO NOT)

- ❌ Do not use "cutting-edge", "industry-leading", "best-in-class", or "world-class" — these are noise
- ❌ Do not propose a waterfall/big-bang delivery — always phased with gates
- ❌ Do not include a timeline longer than 6 months without phasing it into discrete stages
- ❌ Do not reference compliance certifications without explaining what they mean for the client
- ❌ Do not write a generic "About Us" section — replace with relevant credentials for *this* client
- ❌ Do not use acronyms without spelling them out on first use (even SOC 2, PCI-DSS)
- ❌ Do not include placeholder text ("TBD", "to be confirmed") in the final proposal

---

## Section-Specific Notes

**Executive Summary:** Must stand alone. An executive who reads only this section should understand the business problem, the solution, the investment, and the timeline. Under 500 words. No jargon.

**Technical Approach:** Lead with the system architecture overview. Use a numbered list for the delivery phases. Call out the security-by-design principle explicitly.

**Compliance:** Do not copy-paste generic frameworks. Map each compliance requirement to a specific control in the proposed architecture.

**Pricing:** Present as a comparison table across tiers. Then break down what's included in the recommended tier in detail. End with the ROI case.

**Timeline:** Each milestone must have: name, duration, deliverables, and acceptance criteria. Include "client review gate" between phases.
