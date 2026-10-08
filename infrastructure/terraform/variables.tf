# SSL Infrastructure Variables

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "domain" {
  description = "Primary domain"
  type        = string
  default     = "ssl.cricket"
}

variable "cluster_node_count" {
  description = "Number of nodes in GKE cluster"
  type        = number
  default     = 3
}

variable "db_tier" {
  description = "Cloud SQL tier"
  type        = string
  default     = "db-custom-2-8192"
}
