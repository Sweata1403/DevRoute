# DevRoute — Runbook

A personal operations guide for deploying, maintaining, and tearing down the DevRoute infrastructure on AWS.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-Time Setup](#2-first-time-setup)
3. [Provision AWS Infrastructure (Terraform)](#3-provision-aws-infrastructure-terraform)
4. [Build and Push Docker Image to ECR](#4-build-and-push-docker-image-to-ecr)
5. [Deploy to EC2](#5-deploy-to-ec2)
6. [Verify the Application](#6-verify-the-application)
7. [Stopping AWS Resources (Save Money)](#7-stopping-aws-resources-save-money)
8. [Restarting After a Stop](#8-restarting-after-a-stop)
9. [Destroy All Infrastructure](#9-destroy-all-infrastructure)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

Everything below runs from **WSL (Windows Subsystem for Linux)** unless stated otherwise.

### Tools you need installed

| Tool                     | Purpose                   | Install check         |
| ------------------------ | ------------------------- | --------------------- |
| AWS CLI v2               | Talk to AWS from terminal | `aws --version`       |
| Terraform                | Provision infrastructure  | `terraform --version` |
| Docker Desktop (Windows) | Build images              | `docker --version`    |
| Node.js 24               | Run/test the app locally  | `node --version`      |
| psql                     | Test RDS connection       | `psql --version`      |

### AWS credentials configured

```bash
# Check that your devroute-deploy IAM user is set up
aws sts get-caller-identity
# Expected: "Arn": "arn:aws:iam::131540502908:user/devroute-deploy"
```

If not configured yet:

```bash
aws configure
# AWS Access Key ID: <your key>
# AWS Secret Access Key: <your secret>
# Default region: us-east-1
# Default output format: json
```

### SSH key for EC2

```bash
# Check if the key exists
ls ~/.ssh/devroute*
# Should show: devroute  devroute.pub

# If missing, generate it:
ssh-keygen -t rsa -b 4096 -f ~/.ssh/devroute -N ""
```

---

## 2. First-Time Setup

### S3 bucket for Terraform state (one-time, already done)

The Terraform state is stored remotely in S3 so it's not lost if you switch machines.

```bash
# This bucket already exists — don't recreate it
# devroute-terraform-state-131540502908 (us-east-1, versioning enabled)

# To verify:
aws s3 ls s3://devroute-terraform-state-131540502908
```

---

## 3. Provision AWS Infrastructure (Terraform)

All Terraform files live in `infra/terraform/environments/free-tier/`.

### What gets created

- **VPC** with public + private subnets across 2 AZs
- **EC2 t3.micro** — runs the Docker containers (free tier eligible)
- **RDS db.t3.micro PostgreSQL** — managed database in private subnet (free tier eligible)
- **ECR repository** — stores Docker images
- **IAM role** — lets EC2 pull images from ECR without hardcoded credentials
- **Security groups** — EC2 open on ports 22 + 3000; RDS only reachable from EC2

### Run Terraform

```bash
cd infra/terraform/environments/free-tier

# Initialize (downloads providers, connects to S3 backend)
terraform init

# Preview what will be created — always review this first
terraform plan -var="db_password=YourPasswordHere" -var="jwt_secret=YourJwtSecretHere"

# Apply (creates everything, takes ~5–10 minutes)
terraform apply -var="db_password=YourPasswordHere" -var="jwt_secret=YourJwtSecretHere"
```

> **Password rules**: RDS password must be 8–41 characters, **alphanumeric only** — no `@`, `/`, `"`, or spaces. Example: `Neha14032002`

### Save the outputs

After apply, Terraform prints:

```
ec2_public_ip     = "x.x.x.x"
ecr_repository_url = "131540502908.dkr.ecr.us-east-1.amazonaws.com/devroute-api"
rds_endpoint      = "devroute-postgres.xxxxx.us-east-1.rds.amazonaws.com"
```

Save these — you'll need them in the next steps.

```bash
# Or fetch them any time with:
terraform output
```

---

## 4. Build and Push Docker Image to ECR

Run all of this from your **project root** in WSL.

### Step 1 — Authenticate Docker with ECR

ECR login tokens expire after 12 hours. Run this each session before pushing.

```bash
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin \
    131540502908.dkr.ecr.us-east-1.amazonaws.com
# Expected: Login Succeeded
```

### Step 2 — Build the Docker image

```bash
docker build -t devroute-api ./services/api
```

### Step 3 — Tag the image for ECR

```bash
docker tag devroute-api:latest \
  131540502908.dkr.ecr.us-east-1.amazonaws.com/devroute-api:latest
```

### Step 4 — Push to ECR

```bash
docker push 131540502908.dkr.ecr.us-east-1.amazonaws.com/devroute-api:latest
# Takes 1–3 minutes on first push; faster after (layers are cached)
```

---

## 5. Deploy to EC2

### SSH into the EC2 instance

```bash
# Replace x.x.x.x with the EC2 public IP from terraform output
ssh -i ~/.ssh/devroute ubuntu@x.x.x.x
```

> **Note:** EC2's public IP **changes every time you stop and start** the instance. Always get the current IP with `terraform output` or from the AWS Console.

### First-time deploy — create docker-compose.yml on EC2

Run this once (or whenever the config changes). Replace the placeholders with your real values.

```bash
sudo mkdir -p /app

sudo tee /app/docker-compose.yml > /dev/null <<'EOF'
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped

  api:
    image: 131540502908.dkr.ecr.us-east-1.amazonaws.com/devroute-api:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - POSTGRES_HOST=devroute-postgres.xxxxx.us-east-1.rds.amazonaws.com
      - POSTGRES_PORT=5432
      - POSTGRES_DB=devroute
      - POSTGRES_USER=devroute
      - POSTGRES_PASSWORD=YourPasswordHere
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=YourJwtSecretHere
      - BASE_URL=http://x.x.x.x:3000
    depends_on:
      - redis
EOF
```

### Authenticate ECR on EC2

The EC2 instance has an IAM role attached, so no credentials are needed — just login:

```bash
aws ecr get-login-password --region us-east-1 \
  | sudo docker login --username AWS --password-stdin \
    131540502908.dkr.ecr.us-east-1.amazonaws.com
```

### Pull and start containers

```bash
cd /app

# Pull latest image
sudo docker-compose pull

# Start in background
sudo docker-compose up -d

# Check containers are running
sudo docker-compose ps
```

> **Important:** On the EC2 instance, use `sudo docker-compose` (hyphenated), not `docker compose` (space). The installed Docker version requires the hyphenated form.

### Re-deploy after a code change

Every time you push a new Docker image:

```bash
# On EC2:
cd /app
sudo docker-compose pull          # pull new image from ECR
sudo docker-compose up -d         # recreate containers with new image
sudo docker-compose logs -f api   # watch logs to confirm startup
```

---

## 6. Verify the Application

Run these from your local WSL (replace `x.x.x.x` with EC2 public IP).

### Health check

```bash
curl http://x.x.x.x:3000/health
# Expected: {"status":"ok"}
```

### Register a user

```bash
curl -X POST http://x.x.x.x:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
# Expected: {"token":"eyJ..."}
```

### Create a short link

```bash
# Use the token from the register response
curl -X POST http://x.x.x.x:3000/api/links \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{"url":"https://github.com/Sweata1403/DevRoute"}'
# Expected: {"id":1,"code":"abc12345","url":"https://...","clicks":0,...}
```

### Test the redirect

```bash
# Use the code from the create response
curl -L http://x.x.x.x:3000/YOUR_CODE_HERE
# Expected: full HTML of the destination page (GitHub in this case)
```

---

## 7. Stopping AWS Resources (Save Money)

**Always stop EC2 and RDS when not actively working.** They bill by the hour even on free tier once the 750 hours/month limit is hit.

### Stop EC2

```bash
# Find your instance ID
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=devroute-app" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text

# Stop it
aws ec2 stop-instances --instance-ids i-XXXXXXXXXXXXXXXXX
```

Or via Console: EC2 → Instances → select instance → Instance State → **Stop**

### Stop RDS

```bash
aws rds stop-db-instance --db-instance-identifier devroute-postgres
```

Or via Console: RDS → Databases → `devroute-postgres` → Actions → **Stop temporarily**

> **Note:** AWS automatically restarts a stopped RDS instance after 7 days. That's fine — just stop it again if needed.

### What costs nothing while stopped

- **S3** (Terraform state) — essentially free at this scale
- **ECR** — first 500 MB/month free
- **VPC, subnets, security groups** — no charge
- **Stopped EC2** — no compute charge (EBS volume has a small cost, ~$0.10/month)
- **Stopped RDS** — no compute charge (storage ~$0.115/GB/month)

---

## 8. Restarting After a Stop

### Start EC2

```bash
aws ec2 start-instances --instance-ids i-XXXXXXXXXXXXXXXXX

# Wait ~1 minute, then get the new public IP
aws ec2 describe-instances \
  --instance-ids i-XXXXXXXXXXXXXXXXX \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text
```

### Start RDS

```bash
aws rds start-db-instance --db-instance-identifier devroute-postgres

# Wait ~3–5 minutes for it to be "available"
aws rds describe-db-instances \
  --db-instance-identifier devroute-postgres \
  --query "DBInstances[0].DBInstanceStatus" \
  --output text
```

### Update docker-compose.yml with the new EC2 IP

The `BASE_URL` in `/app/docker-compose.yml` on EC2 needs to match the new IP:

```bash
# SSH in with the new IP
ssh -i ~/.ssh/devroute ubuntu@NEW_IP

# Edit the file
sudo nano /app/docker-compose.yml
# Update: BASE_URL=http://NEW_IP:3000

# Re-authenticate ECR (login expires)
aws ecr get-login-password --region us-east-1 \
  | sudo docker login --username AWS --password-stdin \
    131540502908.dkr.ecr.us-east-1.amazonaws.com

# Restart containers
cd /app && sudo docker-compose up -d
```

---

## 9. Destroy All Infrastructure

Use this when you're done with the project and want to delete everything from AWS.

```bash
cd infra/terraform/environments/free-tier

terraform destroy -var="db_password=YourPasswordHere" -var="jwt_secret=YourJwtSecretHere"
```

Type `yes` when prompted. This deletes EC2, RDS, ECR, VPC, subnets, and all related resources.

> **The S3 bucket for Terraform state is NOT deleted by this** — Terraform protects it. Delete it manually from the AWS Console if you want to clean up completely.

---

## 10. Troubleshooting

### App containers keep restarting

```bash
# On EC2 — check logs for errors
sudo docker-compose logs api

# Common causes:
# - DB connection failing (check POSTGRES_HOST is correct RDS endpoint)
# - RDS not started yet (wait 3–5 minutes after starting)
# - Wrong password in docker-compose.yml
```

### ECR pull fails on EC2 with "no credentials"

```bash
# Re-authenticate ECR
aws ecr get-login-password --region us-east-1 \
  | sudo docker login --username AWS --password-stdin \
    131540502908.dkr.ecr.us-east-1.amazonaws.com

# If it says "unable to locate credentials", the IAM role may have detached
# Check in AWS Console: EC2 → Instance → Security → IAM Role
# Should show: devroute-ec2-role
```

### RDS connection refused / SSL error

The app connects to RDS with SSL. If you see SSL errors in logs:

- Check that `NODE_ENV=production` is set in docker-compose.yml (SSL is only enabled in production mode)
- The `ssl: { rejectUnauthorized: false }` in `postgres.js` is intentional — RDS uses a self-signed cert within the VPC

### docker-compose: command not found

```bash
# Use the hyphenated version on this EC2 instance
sudo docker-compose up -d    # ✓ correct
sudo docker compose up -d    # ✗ fails on older Docker
```

### EC2 public IP not found

```bash
# Get it from AWS CLI
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=devroute-app" \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text

# Or from Terraform (if state is up to date)
cd infra/terraform/environments/free-tier && terraform output ec2_public_ip
```

### Database migrations didn't run

The app runs migrations automatically on startup. If they failed silently:

```bash
# Check logs
sudo docker-compose logs api | grep -i migrat

# Connect to RDS directly to inspect tables
psql -h devroute-postgres.xxxxx.us-east-1.rds.amazonaws.com \
     -U devroute -d devroute
# Password: YourPasswordHere

# Inside psql:
\dt          # list tables
\q           # quit
```

---

## Quick Reference

| Action             | Command                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSH into EC2       | `ssh -i ~/.ssh/devroute ubuntu@EC2_IP`                                                                                                                                                                                           |
| Get current EC2 IP | `terraform output ec2_public_ip`                                                                                                                                                                                                 |
| ECR login (local)  | `aws ecr get-login-password --region us-east-1 \| docker login --username AWS --password-stdin 131540502908.dkr.ecr.us-east-1.amazonaws.com`                                                                                     |
| Build + push image | `docker build -t devroute-api ./services/api && docker tag devroute-api:latest 131540502908.dkr.ecr.us-east-1.amazonaws.com/devroute-api:latest && docker push 131540502908.dkr.ecr.us-east-1.amazonaws.com/devroute-api:latest` |
| Redeploy on EC2    | `cd /app && sudo docker-compose pull && sudo docker-compose up -d`                                                                                                                                                               |
| View app logs      | `sudo docker-compose logs -f api`                                                                                                                                                                                                |
| Health check       | `curl http://EC2_IP:3000/health`                                                                                                                                                                                                 |
| Stop EC2           | `aws ec2 stop-instances --instance-ids i-XXXXXXXXXXXXXXXXX`                                                                                                                                                                      |
| Stop RDS           | `aws rds stop-db-instance --db-instance-identifier devroute-postgres`                                                                                                                                                            |
