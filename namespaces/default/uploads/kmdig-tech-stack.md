# KMDIG Technologies — Current Technology Stack
**Document type:** Internal engineering reference
**Maintained by:** Ravi Gowda, Infrastructure Lead
**Last reviewed:** January 2026

---

## IoT & Ingestion Layer

| Component | Details | Status |
|---|---|---|
| MQTT Broker | Mosquitto 2.0.18, single EC2 t3.medium, ap-south-1 | **Critical risk** — single point of failure |
| MQTT protocol | v3.1.1 (some sensors use v5) | Mixed |
| RS-485 legacy | Local data loggers (various vendors) batch upload via SFTP every 1h | Active — ~10% of fleet |
| HTTP REST ingest | Custom FastAPI endpoint for firmware OTA responses | Active, low volume |
| Message format | JSON over MQTT. Schema varies by device model — not standardised | Pain point |

**Known issues:**
- Mosquitto has no clustering or HA configuration
- No dead-letter queue — malformed messages are silently dropped
- No ingestion monitoring — Mosquitto uptime discovered retrospectively
- Topic naming convention is inconsistent across device firmware versions

---

## Storage

| System | Version | Use | Host |
|---|---|---|---|
| PostgreSQL | 14.11 | All telemetry, device registry, customer data | AWS RDS db.t3.large, 2 vCPU, 8GB RAM |
| S3 | N/A | ML model artefacts, firmware binaries, report PDFs | AWS ap-south-1 |
| Redis | 6.2 (ElastiCache) | Session store for internal tools only | t3.micro |

**PostgreSQL pain points (direct from Sanjay):**
- Current size: 1.1 TB in a single `telemetry` table — no partitioning
- No indexes on `device_id + timestamp` combination (added to list after first outage)
- Rolling window queries (6h, 24h) take 45–90 seconds at current data volume
- RDS automated backups enabled, 7-day retention. Recovery has never been tested.
- No read replicas. Analytics queries contend with production writes.

---

## ML & Analytics

| Tool | Usage | Status |
|---|---|---|
| Jupyter Notebook (local) | Feature engineering, model training | Manual, no automation |
| scikit-learn 1.4 | Random Forest model (current production model) | Single model, no versioning |
| pandas / numpy | Data processing in notebooks | Standard |
| S3 | Model artefact storage (`model.pkl` — overwritten on each run) | No versioning |
| No MLflow / no model registry | — | Gap |
| No feature store | Rolling features recomputed from scratch each training run | Inefficient |

**ML pipeline summary:**
1. Sanjay manually pulls data from PostgreSQL to a local CSV (every Monday)
2. Runs feature engineering notebook (≈ 45 minutes on his laptop)
3. Retrains Random Forest, evaluates on holdout set
4. Saves `model.pkl` to S3 (overwrites previous)
5. A separate Lambda function loads `model.pkl` from S3 and runs batch scoring daily (not hourly)
6. Scores written back to a PostgreSQL table
7. A Python script emails a CSV "at risk" list to field engineers

**No monitoring of model performance over time. No alerting on model drift.**

---

## Application Layer

| Service | Stack | Host | Notes |
|---|---|---|---|
| Internal ops tool | FastAPI (Python 3.11) + React 18 | EC2 t3.small | Used by field ops team. Not customer-facing. |
| Device firmware update service | FastAPI + Celery + Redis | EC2 t3.medium | Manages OTA firmware pushes |
| Reporting service | Python script (cron job on EC2) | EC2 t3.micro | Generates weekly PDF reports, emails to customers |
| Zoho CRM | SaaS | Zoho cloud | Customer accounts, service tickets, failure records |
| Internal ticketing | Jira (cloud) | Atlassian cloud | Engineering and field ops tickets |

**No customer-facing portal exists.** Customers receive emails and PDFs only.

---

## Infrastructure & DevOps

| Area | Current State | Assessment |
|---|---|---|
| Cloud | AWS ap-south-1 exclusively | Good — data residency aligned |
| Compute | Mix of EC2 instances (manually provisioned) | No auto-scaling, no containers in prod |
| Containers | Docker used in CI only, not in production | Gap |
| Kubernetes | None in production. Ravi has EKS experience from a previous job | Gap |
| IaC | Terraform for ~40% of infra. Remainder is console-provisioned | Inconsistent |
| CI/CD | GitHub Actions (build + test). Manual deployments via SSH/rsync | No CD pipeline |
| Secrets | AWS Secrets Manager (partially). Some credentials in .env files in EC2 | Security risk |
| Monitoring | AWS CloudWatch metrics and basic alarms | No APM, no distributed tracing |
| Logging | CloudWatch Logs. No log aggregation or structured logging | Difficult to query |
| Alerting | CloudWatch alarms → SNS → email. No PagerDuty. | Reactive only |
| DR/BCP | RDS automated backups only. No DR runbook. | Critical gap |

---

## Networking & Security

- VPC with public and private subnets (standard AWS setup, not consistently enforced)
- Security groups are manually managed and not reviewed regularly
- No WAF on any public endpoint
- TLS 1.2 on MQTT broker (not 1.3)
- No VPN for remote engineer access — direct EC2 SSH with key pairs
- No centralised IAM policy management (individual IAM users with inconsistent permissions)
- VAPT: Never performed

---

## Development Practices

| Practice | Status |
|---|---|
| Version control | GitHub (private org). All teams use it. |
| Branch strategy | Feature branches + main. No release branches. |
| Code review | Informal PR reviews. No enforced approval count. |
| Testing | Unit tests exist for some services. No integration tests. No CI quality gates. |
| Documentation | Sparse. Most knowledge is in Slack threads or people's heads. |
| API documentation | Swagger/OpenAPI for some FastAPI services. Not maintained. |

---

## Team Skills Summary

| Skill | Strength | Gap |
|---|---|---|
| Python (FastAPI, scrikit-learn) | Strong | — |
| React / TypeScript | Moderate | TypeScript adoption incomplete |
| AWS (EC2, RDS, S3, Lambda) | Moderate | Advanced services (MSK, Timestream, EKS) |
| Kafka / streaming | None | Major gap |
| MLOps (MLflow, feature stores) | None | Major gap |
| Kubernetes / EKS | Beginner (Ravi only) | Gap |
| Terraform | Partial | Inconsistent usage |
| Observability (Prometheus, Grafana, tracing) | None | Gap |
| Security / VAPT | None | Gap |
| Real-time frontend (WebSockets, SSE) | None | Gap |

---

## Monthly Cloud Cost Breakdown (approx. Jan 2026)

| Service | Monthly Cost (INR) |
|---|---|
| EC2 instances (4 × t3.medium, 2 × t3.small, 1 × t3.micro) | ₹52,000 |
| RDS (db.t3.large, multi-AZ disabled) | ₹38,000 |
| ElastiCache Redis (t3.micro) | ₹6,500 |
| S3 (12 TB stored) | ₹9,000 |
| Data transfer / CloudWatch / Lambda | ₹14,500 |
| **Total** | **₹1,20,000 / month (~$1,440 USD)** |

*Note: Ravi reported total as "about ₹8 lakhs/month" — this appears to be an error or
includes reserved instance billing and support charges. Actual on-demand equivalent is
closer to ₹1.2 lakhs. Will clarify.*
