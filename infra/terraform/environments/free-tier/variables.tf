variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "db_username" {
  description = "RDS master username"
  type        = string
  default     = "devroute"
}

variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT signing secret"
  type        = string
  sensitive   = true
}

variable "public_key_path" {
  description = "Path to SSH public key"
  type        = string
  default     = "~/.ssh/devroute.pub"
}