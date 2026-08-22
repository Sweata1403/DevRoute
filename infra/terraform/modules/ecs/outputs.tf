output "alb_dns_name" {
  description = "Load balancer URL — this is your app's public address"
  value       = aws_lb.main.dns_name
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "service_name" {
  value = aws_ecs_service.api.name
}