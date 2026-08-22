variable "environment" {
  type    = string
  default = "dev"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "image_tag" {
  description = "Docker image tag to deploy — set by Jenkins during deployment"
  type        = string
  default     = "latest"
}

variable "db_password" {
  description = "Postgres master password — never hardcode, always pass as secret"
  type        = string
  sensitive   = true
}