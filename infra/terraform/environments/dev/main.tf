# Tell Terraform to use AWS and which region
provider "aws" {
  region = var.aws_region
}

# Store Terraform state in S3 so the whole team shares it
# Run the s3 module once first to create this bucket, then uncomment this block
# terraform {
#   backend "s3" {
#     bucket         = "devroute-terraform-state-dev"
#     key            = "dev/terraform.tfstate"
#     region         = "us-east-1"
#     dynamodb_table = "devroute-terraform-locks"
#     encrypt        = true
#   }
# }

# ── VPC ────────────────────────────────────────────────────────────
module "vpc" {
  source = "../../modules/vpc"

  environment        = var.environment
  vpc_cidr           = "10.0.0.0/16"
  availability_zones = 2
  # dev uses 2 AZs — prod would use 3
}

# ── ECR (Container Registry) ───────────────────────────────────────
module "ecr" {
  source = "../../modules/ecr"

  environment = var.environment
}

# ── RDS (Postgres) ─────────────────────────────────────────────────
module "rds" {
  source = "../../modules/rds"

  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  vpc_cidr           = "10.0.0.0/16"
  private_subnet_ids = module.vpc.private_subnet_ids

  instance_class        = "db.t3.micro"   # smallest/cheapest for dev
  allocated_storage     = 20
  multi_az              = false           # single AZ is fine for dev
  backup_retention_days = 1              # 1 day backup in dev, 7 in prod

  db_username = "devroute"
  db_password = var.db_password          # comes from terraform.tfvars (secret)
}

# ── ECS (App containers) ───────────────────────────────────────────
module "ecs" {
  source = "../../modules/ecs"

  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  private_subnet_ids = module.vpc.private_subnet_ids

  ecr_repository_url  = module.ecr.repository_url
  image_tag           = var.image_tag

  task_cpu      = 256    # 0.25 vCPU — smallest Fargate size
  task_memory   = 512    # 512 MB
  desired_count = 1      # 1 container in dev, 2+ in prod

  execution_role_arn  = aws_iam_role.ecs_execution.arn
  task_role_arn       = aws_iam_role.ecs_task.arn

  db_host             = module.rds.endpoint
  db_username         = "devroute"
  db_password_ssm_arn = aws_ssm_parameter.db_password.arn
  redis_host          = "localhost"   # placeholder until ElastiCache module added
  aws_region          = var.aws_region
}

# ── IAM Roles ──────────────────────────────────────────────────────
# Execution role — lets ECS pull images from ECR and write logs
resource "aws_iam_role" "ecs_execution" {
  name = "devroute-ecs-execution-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Task role — what your running app is allowed to do
resource "aws_iam_role" "ecs_task" {
  name = "devroute-ecs-task-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# ── SSM Parameter — DB password stored securely ────────────────────
resource "aws_ssm_parameter" "db_password" {
  name  = "/devroute/${var.environment}/db_password"
  type  = "SecureString"     # encrypted at rest in AWS
  value = var.db_password

  tags = {
    Environment = var.environment
  }
}