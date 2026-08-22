# Security group for the Load Balancer — open to internet
resource "aws_security_group" "alb" {
  name        = "devroute-alb-${var.environment}"
  description = "Allow HTTP/HTTPS from internet"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "devroute-alb-sg-${var.environment}"
    Environment = var.environment
  }
}

# Security group for ECS tasks — only allow traffic FROM the ALB
resource "aws_security_group" "ecs_tasks" {
  name        = "devroute-ecs-${var.environment}"
  description = "Allow traffic from ALB only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "From ALB only — not from internet directly"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "devroute-ecs-sg-${var.environment}"
    Environment = var.environment
  }
}

# Application Load Balancer — public facing
resource "aws_lb" "main" {
  name               = "devroute-alb-${var.environment}"
  internal           = false       # false = internet-facing
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids  # ALB lives in public subnets

  tags = {
    Name        = "devroute-alb-${var.environment}"
    Environment = var.environment
  }
}

# Target group — ALB forwards traffic here, health checks containers
resource "aws_lb_target_group" "api" {
  name        = "devroute-api-${var.environment}"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"  # required for Fargate

  health_check {
    path                = "/health"   # your GET /health endpoint
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"       # expect HTTP 200
  }
}

# ALB listener — listens on port 80, forwards to target group
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# ECS Cluster — logical grouping of your tasks
resource "aws_ecs_cluster" "main" {
  name = "devroute-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"   # sends metrics to CloudWatch automatically
  }

  tags = {
    Name        = "devroute-${var.environment}"
    Environment = var.environment
  }
}

# Task Definition — describes your container (image, CPU, memory, env vars)
resource "aws_ecs_task_definition" "api" {
  family                   = "devroute-api-${var.environment}"
  network_mode             = "awsvpc"      # required for Fargate
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = var.execution_role_arn  # lets ECS pull from ECR
  task_role_arn            = var.task_role_arn        # what your app can access

  container_definitions = jsonencode([
    {
      name      = "devroute-api"
      image     = "${var.ecr_repository_url}:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV",       value = var.environment },
        { name = "PORT",           value = "3000" },
        { name = "BASE_URL",       value = "http://${aws_lb.main.dns_name}" },
        { name = "POSTGRES_HOST",  value = var.db_host },
        { name = "POSTGRES_PORT",  value = "5432" },
        { name = "POSTGRES_DB",    value = "devroute" },
        { name = "POSTGRES_USER",  value = var.db_username },
        { name = "REDIS_HOST",     value = var.redis_host },
        { name = "REDIS_PORT",     value = "6379" }
      ]

      secrets = [
        # Pulled from AWS SSM Parameter Store at runtime — never in plaintext
        {
          name      = "POSTGRES_PASSWORD"
          valueFrom = var.db_password_ssm_arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/devroute-${var.environment}"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 15
      }
    }
  ])
}

# ECS Service — keeps your task running, handles rolling deployments
resource "aws_ecs_service" "api" {
  name            = "devroute-api-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count   # how many containers to run
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids  # tasks run in private subnets
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "devroute-api"
    container_port   = 3000
  }

  # Rolling deployment — bring up new containers before killing old ones
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.http]
}