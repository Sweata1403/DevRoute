output "endpoint" {
  description = "RDS connection endpoint — use this as POSTGRES_HOST in your app"
  value       = aws_db_instance.postgres.endpoint
  # Example: devroute-dev.abc123.us-east-1.rds.amazonaws.com:5432
}

output "db_name" {
  value = aws_db_instance.postgres.db_name
}