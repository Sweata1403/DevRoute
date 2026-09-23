#!/bin/bash
set -e

# Install Docker
apt-get update -y
apt-get install -y docker.io awscli
systemctl start docker
systemctl enable docker

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Login to ECR
aws ecr get-login-password --region ${aws_region} | \
  docker login --username AWS --password-stdin ${ecr_registry}

# Create app directory
mkdir -p /app
cat > /app/docker-compose.yml <<EOF
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped

  api:
    image: ${ecr_registry}:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://devroute:${db_password}@${db_host}:5432/devroute
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${jwt_secret}
      - BASE_URL=http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):3000
    depends_on:
      - redis
EOF

docker-compose -f /app/docker-compose.yml up -d