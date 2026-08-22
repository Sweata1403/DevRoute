resource "aws_security_group" "rds" {
  name        = "devroute-rds-${var.environment}"
  description = "Allow Postgres access from within VPC only"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "Postgres from VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "devroute-rds-sg-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "devroute-${var.environment}"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name        = "devroute-db-subnet-group"
    Environment = var.environment
  }
}

resource "aws_db_instance" "postgres" {
  identifier = "devroute-${var.environment}"

  engine         = "postgres"
  engine_version = "15"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 2

  db_name  = "devroute"
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period = var.backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  multi_az            = var.multi_az
  deletion_protection = var.environment == "prod" ? true : false
  skip_final_snapshot = var.environment == "prod" ? false : true

  tags = {
    Name        = "devroute-postgres-${var.environment}"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}