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
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# VPC - simple, no NAT Gateway
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "devroute-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "devroute-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = { Name = "devroute-public-subnet" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "devroute-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Security Group for EC2
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
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "API"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "devroute-ec2-sg" }
}

# Security Group for RDS
resource "aws_security_group" "rds" {
  name        = "devroute-rds-sg"
  description = "Security group for DevRoute RDS"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
    description     = "PostgreSQL from EC2 only"
  }

  tags = { Name = "devroute-rds-sg" }
}

# RDS Subnet Group (needs 2 AZs minimum)
resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "${var.aws_region}b"

  tags = { Name = "devroute-private-subnet" }
}

resource "aws_db_subnet_group" "main" {
  name       = "devroute-db-subnet-group"
  subnet_ids = [aws_subnet.public.id, aws_subnet.private.id]

  tags = { Name = "devroute-db-subnet-group" }
}

# RDS PostgreSQL - free tier
resource "aws_db_instance" "postgres" {
  identifier        = "devroute-postgres"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  storage_type      = "gp2"

  db_name  = "devroute"
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  publicly_accessible     = false
  skip_final_snapshot     = true
  backup_retention_period = 0

  tags = { Name = "devroute-postgres" }
}

# ECR Repository
resource "aws_ecr_repository" "api" {
  name                 = "devroute-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "devroute-api" }
}

# Key pair for SSH
resource "aws_key_pair" "devroute" {
  key_name   = "devroute-key"
  public_key = file(var.public_key_path)
}

# EC2 t2.micro - free tier
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  key_name               = aws_key_pair.devroute.key_name

  user_data = templatefile("${path.module}/userdata.sh", {
    ecr_registry = aws_ecr_repository.api.repository_url
    db_host      = aws_db_instance.postgres.address
    db_password  = var.db_password
    jwt_secret   = var.jwt_secret
    aws_region   = var.aws_region
  })

  tags = { Name = "devroute-app" }
}