#!/bin/bash
set -euo pipefail
exec > /var/log/userdata.log 2>&1

echo "=== DevRoute Bootstrap: $(date) ==="

# ─── System packages ─────────────────────────────────────────────────────────
apt-get update -y
apt-get install -y \
  docker.io \
  awscli \
  curl \
  git \
  jq

systemctl start docker
systemctl enable docker

# Add ubuntu user to docker group so Jenkins can run docker commands
usermod -aG docker ubuntu

# ─── Docker Compose ──────────────────────────────────────────────────────────
curl -fsSL \
  "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# ─── Postgres & Redis containers (local, free-tier) ──────────────────────────
docker network create devroute-network || true

docker run -d \
  --name devroute-postgres \
  --network devroute-network \
  --restart unless-stopped \
  -e POSTGRES_DB=devroute \
  -e POSTGRES_USER=devroute \
  -e POSTGRES_PASSWORD="${db_password}" \
  -v devroute-pg-data:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:15-alpine

docker run -d \
  --name devroute-redis \
  --network devroute-network \
  --restart unless-stopped \
  -p 6379:6379 \
  redis:7-alpine

# ─── Jenkins ─────────────────────────────────────────────────────────────────
docker run -d \
  --name jenkins \
  --restart unless-stopped \
  -p 8080:8080 \
  -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  jenkins/jenkins:lts

# Give Jenkins docker access
sleep 5
docker exec jenkins bash -c "apt-get update -y && apt-get install -y docker.io" || true
chmod 666 /var/run/docker.sock

# ─── Write ECR login refresh cron (tokens expire every 12h) ──────────────────
cat > /usr/local/bin/ecr-login.sh <<'ECRSCRIPT'
#!/bin/bash
aws ecr get-login-password --region ${aws_region} | \
  docker login --username AWS --password-stdin ${ecr_registry}
ECRSCRIPT
chmod +x /usr/local/bin/ecr-login.sh

# Run once now
/usr/local/bin/ecr-login.sh

# Refresh every 6 hours
echo "0 */6 * * * root /usr/local/bin/ecr-login.sh >> /var/log/ecr-login.log 2>&1" \
  > /etc/cron.d/ecr-login

echo "=== Bootstrap complete: $(date) ==="
echo "Jenkins initial password will be at: docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword"
