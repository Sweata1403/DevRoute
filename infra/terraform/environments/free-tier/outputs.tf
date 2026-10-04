output "instance_public_ip" {
  description = "Elastic IP of the EC2 instance (stable across reboots)"
  value       = aws_eip.app.public_ip
}

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.app.id
}

output "ecr_repository_url" {
  description = "ECR repository URL for docker push/pull"
  value       = aws_ecr_repository.api.repository_url
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "ssh_command" {
  description = "SSH into the EC2 instance"
  value       = "ssh -i ~/.ssh/devroute ubuntu@${aws_eip.app.public_ip}"
}

output "jenkins_url" {
  description = "Jenkins web UI"
  value       = "http://${aws_eip.app.public_ip}:8080"
}

output "app_url" {
  description = "Production API"
  value       = "http://${aws_eip.app.public_ip}:3000"
}
