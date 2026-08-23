<div align="center">

# 🚀 DevRoute

### Production-Grade URL Shortener & Click Analytics Platform

_A fully automated, cloud-native application demonstrating end-to-end DevOps engineering_

[![GitHub Actions](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=github-actions&logoColor=white)](https://github.com/Sweata1403/DevRoute/actions)
[![GitLab CI](https://img.shields.io/badge/Build-GitLab%20CI-FC6D26?logo=gitlab&logoColor=white)](https://gitlab.com/sweata_practice/devroute)
[![Terraform](https://img.shields.io/badge/IaC-Terraform-7B42BC?logo=terraform&logoColor=white)](https://www.terraform.io/)
[![AWS](https://img.shields.io/badge/Cloud-AWS-FF9900?logo=amazon-aws&logoColor=white)](https://aws.amazon.com/)
[![Docker](https://img.shields.io/badge/Container-Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

</div>

---

## 📌 What is DevRoute?

DevRoute is a URL shortener and click analytics API — similar to Bitly — where users create short links, share them, and track how many times they were clicked, from which locations, and on which devices.

The application itself is intentionally simple. The engineering challenge is everything around it: automated quality gates, immutable Docker image builds, infrastructure-as-code, configuration management, and production-grade observability — all wired together into a single delivery pipeline that takes code from a developer's laptop to a live AWS environment with zero manual steps.

---

## 🎯 Project Objective

Most DevOps tutorials teach tools in isolation. This project treats them as they exist in real engineering teams — each tool owns a specific responsibility, and they hand off to each other automatically.

| Stage             | Tool                 | Responsibility                                    |
| ----------------- | -------------------- | ------------------------------------------------- |
| Code Quality Gate | GitHub Actions       | Lint, unit tests, SAST scan on every PR           |
| Build & Artifact  | GitLab CI            | Docker build, Trivy vulnerability scan, ECR push  |
| Deployment        | Jenkins              | Dev → Staging → Prod with human approval gates    |
| Infrastructure    | Terraform            | AWS VPC, ECS, RDS, ECR — all version-controlled   |
| Configuration     | Ansible              | Jenkins agent, GitLab runner, Node Exporter setup |
| Observability     | Prometheus + Grafana | Metrics, dashboards, and alerting                 |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        DEVELOPER                            │
└──────────────────────┬──────────────────────────────────────┘
                       │ opens Pull Request
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   GITHUB ACTIONS                            │
│         Lint  →  Unit Tests  →  SAST Scan                   │
└──────────────────────┬──────────────────────────────────────┘
                       │ merge to main
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    GITLAB CI                                │
│       Docker Build  →  Trivy Scan  →  Push to ECR          │
└──────────────────────┬──────────────────────────────────────┘
                       │ image tag
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                     JENKINS                                 │
│   Deploy Dev → [Approve] → Staging → [Approve] → Prod       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                       AWS                                   │
│                                                             │
│   Internet → ALB → ECS Fargate (Node.js API)                │
│                         │            │                      │
│                     PostgreSQL     Redis                    │
│                       (RDS)        (Cache)                  │
│                                                             │
│   Prometheus → Grafana → Alertmanager → PagerDuty / Slack   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

**Application**

- Node.js 20 + Express — REST API
- PostgreSQL 15 — persistent storage with connection pooling
- Redis 7 — caching layer with graceful degradation (cache miss falls back to DB without crashing)
- Prometheus client — custom metrics exposed at `/metrics`

**Infrastructure (AWS)**

- ECS Fargate — serverless containers, no EC2 management
- RDS PostgreSQL — managed database in private subnets
- Application Load Balancer — traffic distribution and health checking
- ECR — private Docker image registry
- SSM Parameter Store — secrets management (DB password never in plaintext)
- VPC — isolated network with public/private subnet separation

**CI/CD Pipeline**

- GitHub Actions — PR validation (lint, tests, Semgrep SAST)
- GitLab CI — Docker build, Trivy container scan, ECR push
- Jenkins — multi-environment deployment with approval gates and auto-rollback

**Infrastructure as Code**

- Terraform — modular AWS infrastructure (vpc, ecr, rds, ecs modules)
- S3 + DynamoDB — remote Terraform state with team locking

**Configuration Management**

- Ansible — idempotent server setup (Docker, Jenkins agent, GitLab runner, Node Exporter)

**Observability**

- Prometheus — metrics scraping
- Grafana — dashboards (RPS, error rate, p95 latency, cache hit rate)
- Alertmanager — PagerDuty for critical alerts, Slack for warnings

---

## 📁 Project Structure

```
DevRoute/
├── services/
│   └── api/                        # Node.js Express application
│       ├── src/
│       │   ├── db/                 # PostgreSQL pool + migrations
│       │   ├── cache/              # Redis client (graceful degradation)
│       │   ├── models/             # Links, clicks, analytics logic
│       │   ├── routes/             # REST API endpoints
│       │   └── middleware/         # Rate limiting, request logging
│       └── Dockerfile              # Multi-stage build
│
├── infra/
│   ├── terraform/
│   │   ├── modules/                # Reusable: vpc, ecr, rds, ecs
│   │   └── environments/dev/       # Dev environment config
│   └── ansible/
│       ├── roles/
│       │   ├── common/             # Docker, deploy user, firewall
│       │   ├── jenkins/            # Jenkins agent + systemd
│       │   ├── gitlab-runner/      # GitLab runner registration
│       │   └── monitoring/         # Prometheus Node Exporter
│       └── playbooks/site.yml      # Master playbook
│
├── ci-cd/
│   └── jenkins/Jenkinsfile         # Deploy pipeline with approvals
│
├── monitoring/
│   ├── prometheus/alert_rules.yml  # APIDown, HighErrorRate, HighLatency
│   ├── grafana/dashboards/         # Pre-provisioned dashboards
│   └── alertmanager/               # PagerDuty + Slack routing
│
├── .github/workflows/
│   ├── pr-validation.yml           # Lint + tests + SAST on every PR
│   └── dependency-check.yml        # Weekly npm audit
│
└── .gitlab-ci.yml                  # Build + Trivy scan + ECR push
```

---

## 🔒 Security Design Decisions

**Secrets never touch the codebase.** Database passwords are stored in AWS SSM Parameter Store as SecureString and injected into ECS tasks at runtime. GitLab CI credentials are stored as masked CI/CD variables.

**Least privilege networking.** ECS tasks only accept traffic from the ALB security group — they are not publicly reachable. RDS only accepts connections from within the VPC CIDR. Nothing in a private subnet is directly internet-accessible.

**Container scanning before every push.** Trivy runs on every image before it reaches ECR. The pipeline fails on HIGH or CRITICAL CVEs — a vulnerable image cannot reach any environment.

**Dependency auditing on a schedule.** A weekly GitHub Actions workflow runs `npm audit` to catch newly disclosed vulnerabilities in existing dependencies.

**Rate limiting at the API layer.** Write endpoints are limited to 20 requests/minute per IP; read endpoints to 200 requests/minute, protecting against abuse without requiring external infrastructure.

---

## 🚦 CI/CD Flow in Detail

### Pull Request (GitHub Actions)

1. Developer opens a PR against `main`
2. ESLint runs — zero warnings policy
3. Jest unit tests run against real Postgres + Redis containers
4. Semgrep scans for OWASP Top 10 and hardcoded secrets
5. All three must pass for the PR to be mergeable

### Merge to main (GitLab CI)

1. Docker image built from multi-stage Dockerfile
2. Image saved as pipeline artifact (not rebuilt in each stage)
3. Trivy scans the saved image — fails on HIGH/CRITICAL CVEs
4. On clean scan: image pushed to ECR with two tags — commit SHA and `latest`
5. `IMAGE_TAG` passed downstream via dotenv artifact

### Deployment (Jenkins)

1. Jenkins picks up `IMAGE_TAG` from GitLab
2. Verifies image exists in ECR
3. Deploys to **dev** ECS cluster, waits for stability
4. Smoke tests the `/health` endpoint
5. **Manual approval** required to proceed to staging
6. Deploys to **staging**, waits for stability
7. **Manual approval** required to proceed to production
8. Deploys to **production**
9. On any deployment failure: automatic rollback to previous ECS task definition

---

## ⚡ Key Engineering Highlights

**Graceful cache degradation** — if Redis goes down, the API continues serving from PostgreSQL. Cache failures are logged and counted as metrics but never propagate as 5xx errors to clients.

**Idempotent infrastructure** — `terraform apply` and `ansible-playbook` can be run repeatedly without side effects. Ansible's `creates:` guard prevents duplicate GitLab runner registration.

**Immutable deployments** — every deployment uses a specific image SHA tag, not `latest`. This means rollbacks are instant (redeploy the previous SHA) and every environment is traceable to an exact commit.

**Connection pooling** — the API uses a PostgreSQL connection pool (max 10 connections) rather than opening a new connection per request. This is essential for Fargate where multiple tasks run concurrently.

**Soft deletes** — links are never physically deleted from the database. Setting `active = FALSE` preserves click history and allows recovery, while immediately stopping redirects.

---

## 🏃 Running Locally

**Prerequisites:** Docker Desktop, Node.js 20

```bash
# Clone the repository
git clone https://github.com/Sweata1403/DevRoute.git
cd DevRoute

# Start all services
docker compose up --build

# Test the API
curl -X POST http://localhost:3000/api/links \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com/Sweata1403/DevRoute"}'

# Follow the short link
curl -L http://localhost:3000/{code}

# View metrics
curl http://localhost:3000/metrics
```

---

## 📊 Observability

The Grafana dashboard (provisioned automatically) tracks:

- **Request Rate** — requests per second across all endpoints
- **Error Rate** — percentage of 5xx responses with threshold alerting
- **p95 Latency** — 95th percentile response time (alert threshold: 1 second)
- **Cache Hit Rate** — Redis hit ratio (alert threshold: below 50%)

Alerts route to **PagerDuty** for critical issues (API down) and **Slack** for warnings (high error rate, high latency, low cache hit rate).

---

## 👨‍💻 Author

**Pritom Chakraborty (Sweata)**

- GitHub: [@Sweata1403](https://github.com/Sweata1403)
- GitLab: [@sweata_practice](https://gitlab.com/sweata_practice)

---

<div align="center">
<i>Built to demonstrate production DevOps practices — not just to make short links.</i>
</div>

