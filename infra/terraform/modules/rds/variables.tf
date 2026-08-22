variable "environment" {
  type = string
}

variable "vpc_id" {
  description = "VPC ID where RDS will live"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block for security group rules"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the DB subnet group"
  type        = list(string)
}

variable "instance_class" {
  description = "RDS instance type"
  type        = string
  default     = "db.t3.micro"
}

variable "allocated_storage" {
  description = "Storage size in GB"
  type        = number
  default     = 20
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "devroute"
}

variable "db_password" {
  description = "Database master password — pass via environment variable, never hardcode"
  type        = string
  sensitive   = true  # Terraform won't print this in logs
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "multi_az" {
  description = "Enable Multi-AZ for high availability"
  type        = bool
  default     = false
}