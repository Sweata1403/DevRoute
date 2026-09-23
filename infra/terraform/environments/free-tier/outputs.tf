output "ec2_public_ip" {
  description = "Public IP of the EC2 instance"
  value       = aws_instance.app.public_ip
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.api.repository_url
}

output "rds_endpoint" {
  description = "RDS endpoint"
  value       = aws_db_instance.postgres.address
}