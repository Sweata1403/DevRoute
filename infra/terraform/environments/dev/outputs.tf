output "alb_url" {
  description = "Your app's public URL after deployment"
  value       = "http://${module.ecs.alb_dns_name}"
}

output "ecr_repository_url" {
  description = "Push Docker images here from CI/CD"
  value       = module.ecr.repository_url
}

output "rds_endpoint" {
  description = "Postgres connection endpoint"
  value       = module.rds.endpoint
}