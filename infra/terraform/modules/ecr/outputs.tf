output "repository_url" {
  description = "Full ECR URL — used by CI/CD to push images"
  value       = aws_ecr_repository.api.repository_url
  # Example: 123456789.dkr.ecr.us-east-1.amazonaws.com/devroute-api-dev
}

output "repository_name" {
  description = "Repository name"
  value       = aws_ecr_repository.api.name
}