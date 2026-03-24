# Request for Proposal
## Real-Time IoT Telemetry & Predictive Maintenance Platform
**Issued by:** KMDIG Technologies Pvt. Ltd.
**RFP Reference:** KMDIG-ENG-2026-001
**Issue Date:** 27 January 2026
**Response Deadline:** 21 February 2026
**Contact:** Deepa Rajan, Head of Engineering — deepa.rajan@kmdig.tech

---

## 1. Company Overview

KMDIG Technologies is a Bengaluru-based industrial equipment manufacturer with 850
employees and FY25 revenue of ₹420 Cr. We design, manufacture, and service industrial
compressors, HVAC chillers, and air handling units for customers in manufacturing,
healthcare, data centres, and government infrastructure sectors.

Our installed base: approximately 14,000 IoT-enabled devices across 2,200 customer
sites in India, Singapore, UAE, and Saudi Arabia.

We are seeking a technology partner to design and build a cloud-native IoT data
platform that will transform how we monitor equipment, predict failures, and deliver
value to customers.

**Budget envelope:** ₹3.2 Cr – ₹4.5 Cr for an 18-month engagement (Phase 1 + Phase 2).
Phase 1 (MVP): fixed-price preferred. Phase 2: T&M with a cap.

---

## 2. Problem Statement

Our current IoT infrastructure is inadequate for scale:

- **Ingestion layer:** A single Mosquitto MQTT broker on a t3.medium EC2 instance.
  No redundancy. Availability is approximately 97% — unacceptable for production.
- **Storage:** PostgreSQL on RDS (1.1 TB). No time-series optimisation. Queries
  on data older than 30 days time out. No archiving strategy.
- **Analytics:** A single Random Forest model run manually by one engineer in a
  Jupyter notebook every Monday. No automation, no versioning, no monitoring.
- **Customer visibility:** None. Customers have no self-service portal or alerts.
  They learn about failures from their own maintenance teams, not from us.
- **Operations:** No centralised monitoring. We discover infrastructure outages
  when customers phone our support line.

The consequences are measurable:
- Two undetected compressor failures in Q1 2026 resulted in customer SLA breaches.
- One failure was at a hospital (critical infrastructure). This is unacceptable.
- Support costs are rising because we react to failures rather than prevent them.
- We are losing RFPs to competitors who can demonstrate predictive analytics.

---

## 3. Scope of Work

### Phase 1 — MVP (Target: 30 September 2026, 6 months from kickoff)

**3.1 Ingestion & Streaming Pipeline**
- Replace single Mosquitto broker with a fault-tolerant, scalable message ingestion layer
- Support MQTT (primary), HTTP/REST (secondary), and RS-485 batch upload (legacy)
- Minimum sustained throughput: 5,000 messages/second
- Message schema validation and dead-letter queue for malformed data
- AWS ap-south-1 only (data residency hard requirement)

**3.2 Time-Series Storage**
- Design and implement a purpose-built time-series storage layer
- Retention policy: raw data 90 days, aggregates 3 years
- Query SLA: any 30-day window for a single device must return in < 2 seconds

**3.3 Feature Engineering Pipeline**
- Automated rolling-window feature computation (1h, 6h, 24h)
- Features: mean, std, min, max for temperature, pressure, current draw, vibration RMS
- Pipeline must complete within 5 minutes of data arrival
- Output features to a feature store for model training and serving

**3.4 Model Training & Registry**
- MLflow integration for experiment tracking and model versioning
- Automated weekly retraining on latest labelled data
- Automated integration with Zoho CRM for failure label extraction
- Support for swapping model types without re-engineering the pipeline

**3.5 Model Serving & Alerting**
- Batch scoring: every device scored hourly
- Alert trigger: if device risk score exceeds threshold, alert customer within 15 minutes
- Alert channels: email, SMS, push notification (Phase 1), webhook (Phase 2)
- Multi-tenant alert routing: alerts go to the correct customer only

**3.6 Customer Portal (Web)**
- Multi-tenant: customers see only their own devices (contractual requirement)
- Device health dashboard: current risk score, status, last seen
- Historical telemetry charts: temperature, pressure, vibration summary, current draw
- Alert history and acknowledgement
- Maintenance recommendation report (PDF download)
- API-first architecture to support future white-labelling and ERP embedding
- Target: 500 concurrent users within 12 months of launch

**3.7 Internal Operations Dashboard**
- Fleet-wide view for KMDIG field engineers
- Filter by region, customer, device model, risk level
- Trigger on-demand diagnostics run for a specific device
- Assign service tickets (integration with internal ticketing — Phase 2)

### Phase 2 — Full Platform (Months 7–18)

- Mobile app (iOS and Android) for customers and field engineers
- Edge processing module for sites with connectivity constraints
- Advanced ML: anomaly detection, remaining useful life (RUL) estimation
- White-label portal SDK for enterprise customers
- Bi-directional device command capability (remote configuration)
- Full Zoho CRM integration (service ticket creation, history sync)
- Multi-region deployment (Singapore for SEA customers)

---

## 4. Technical Requirements

### 4.1 Mandatory
- AWS ap-south-1 deployment. No customer data to leave India.
- Kubernetes (EKS) for all containerised workloads
- Full infrastructure-as-code (Terraform). No manual console changes in production.
- 99.9% uptime SLA for ingestion pipeline and customer portal
- End-to-end data encryption (TLS 1.3 in transit, AES-256 at rest)
- Multi-tenancy enforced at the data layer — row-level security or equivalent
- VAPT (Vulnerability Assessment and Penetration Test) before go-live
- ISO 27001-aligned security practices (KMDIG is pursuing certification in 2027)
- Alert delivery within 15 minutes of model scoring

### 4.2 Preferred
- Apache Kafka or AWS MSK for the streaming backbone
- TimescaleDB or AWS Timestream for time-series storage
- MLflow for model lifecycle management
- Prometheus + Grafana for infrastructure observability
- Distributed tracing (Jaeger or AWS X-Ray)
- GitOps deployment model (ArgoCD or Flux)
- React / TypeScript for the customer portal frontend
- FastAPI for internal microservices (aligns with existing team skills)

---

## 5. Team Expectations

Mandatory delivery model:
- Embedded pairing — vendor engineers work alongside KMDIG engineers
- Minimum 3 days per week on-site in Bengaluru for Phase 1
- All code reviewed by KMDIG engineers before merge
- Knowledge transfer is continuous, not a workshop at the end

Proposed team from vendor (minimum):
- 1 × Solution Architect / Engagement Lead (senior, IoT + cloud native)
- 2 × Backend Engineers (Python, Go, Kafka, AWS)
- 1 × ML/MLOps Engineer (feature pipelines, MLflow, model serving)
- 1 × Frontend Engineer (React, TypeScript, real-time dashboards)
- 1 × DevOps/Platform Engineer (Terraform, EKS, observability)
- 1 × Project Manager (0.5 FTE)

Post-handover: 1 × staff augmentation engineer for 12 months (optional, separate contract).

---

## 6. Evaluation Criteria

| Criterion | Weight |
|---|---|
| Technical approach and architecture quality | 40% |
| Team quality and IoT/ML experience | 25% |
| Delivery methodology and knowledge transfer | 15% |
| Commercial terms and value for money | 15% |
| References (at least 1 IoT or real-time systems project) | 5% |

---

## 7. Submission Requirements

1. Technical architecture document with component diagram
2. Phase 1 sprint plan with milestones and acceptance criteria
3. CVs for all named team members
4. At least one reference IoT, streaming, or MLOps project with contact
5. Pricing: Phase 1 fixed-price breakdown by sprint/milestone
6. IP ownership confirmation (we require full IP transfer on completion)
7. Approach to data residency compliance

Proposals to deepa.rajan@kmdig.tech by 17:00 IST, 21 February 2026.
