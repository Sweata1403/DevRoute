resource "aws_ecr_repository" "api" {
  name                 = "devroute-api-${var.environment}"
  image_tag_mutability = "MUTABLE"
  # MUTABLE = you can overwrite tags like "latest"
  # IMMUTABLE = each tag is permanent (better for prod, but we keep it simple)

  image_scanning_configuration {
    scan_on_push = true
    # Automatically scans every image for known vulnerabilities when pushed
    # This is free and catches issues before they reach production
  }

  tags = {
    Name        = "devroute-api"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Lifecycle policy — automatically delete old images to save storage costs
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images, delete older ones"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}