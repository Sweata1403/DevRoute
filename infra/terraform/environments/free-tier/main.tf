terraform {
  required_version = ">= 1.0"

  backend "s3" {
    bucket = "devroute-terraform-state-131540502908"
    key    = "free-tier/terraform.tfstate"
    region = "us-east-1"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.69"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ─── VPC ─────────────────────────────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "devroute-vpc", ManagedBy = "terraform" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "devroute-igw", ManagedBy = "terraform" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = { Name = "devroute-public-subnet", ManagedBy = "terraform" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "devroute-public-rt", ManagedBy = "terraform" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ─── Security Groups ─────────────────────────────────────────────────────────
resource "aws_security_group" "ec2" {
  name        = "devroute-ec2-sg"
  description = "Security group for DevRoute EC2 instance"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "SSH"
  }

  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Jenkins"
  }

  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "API production"
  }

  ingress {
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "API staging"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = { Name = "devroute-ec2-sg", ManagedBy = "terraform" }
}

# ─── ECR ─────────────────────────────────────────────────────────────────────
resource "aws_ecr_repository" "api" {
  name                 = "devroute-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "devroute-api", ManagedBy = "terraform" }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ─── Key Pair ────────────────────────────────────────────────────────────────
resource "aws_key_pair" "devroute" {
  key_name   = "devroute-key"
  public_key = file(var.public_key_path)
}

# ─── EC2 ─────────────────────────────────────────────────────────────────────
resource "aws_instance" "app" {
  ami                    = "ami-05a3e9423ae4d7a19"
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  key_name               = aws_key_pair.devroute.key_name

  user_data = templatefile("${path.module}/userdata.sh", {
    ecr_registry   = aws_ecr_repository.api.repository_url
    db_password    = var.db_password
    jwt_secret     = var.jwt_secret
    redis_password = var.redis_password
    aws_region     = var.aws_region
  })

  tags = { Name = "devroute-app", ManagedBy = "terraform" }

  lifecycle {
    ignore_changes = [user_data]
  }
}

# Elastic IP — keeps the same IP across reboots / stop-start cycles
resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"

  tags = { Name = "devroute-eip", ManagedBy = "terraform" }
}