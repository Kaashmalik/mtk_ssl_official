# SSL Infrastructure - Main Terraform Configuration
# Phase 2: Infrastructure Setup

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.24"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
  }

  backend "gcs" {
    bucket = "ssl-terraform-state"
    prefix = "terraform/state"
  }
}

# Variables
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
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

# Provider Configuration
provider "google" {
  project = var.project_id
  region  = var.region
}

# VPC Network
resource "google_compute_network" "ssl_vpc" {
  name                    = "ssl-vpc-${var.environment}"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

# Subnets
resource "google_compute_subnetwork" "public" {
  name          = "ssl-public-${var.environment}"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.region
  network       = google_compute_network.ssl_vpc.id

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.1.0.0/16"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.2.0.0/20"
  }
}

resource "google_compute_subnetwork" "private" {
  name                     = "ssl-private-${var.environment}"
  ip_cidr_range            = "10.0.2.0/24"
  region                   = var.region
  network                  = google_compute_network.ssl_vpc.id
  private_ip_google_access = true
}

# Cloud NAT for private subnet
resource "google_compute_router" "ssl_router" {
  name    = "ssl-router-${var.environment}"
  region  = var.region
  network = google_compute_network.ssl_vpc.id
}

resource "google_compute_router_nat" "ssl_nat" {
  name                               = "ssl-nat-${var.environment}"
  router                             = google_compute_router.ssl_router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

# GKE Cluster
resource "google_container_cluster" "ssl_cluster" {
  name     = "ssl-cluster-${var.environment}"
  location = var.region

  # Enable Autopilot for managed experience
  enable_autopilot = false

  # Network configuration
  network    = google_compute_network.ssl_vpc.name
  subnetwork = google_compute_subnetwork.public.name

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  # Private cluster
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  # Remove default node pool
  remove_default_node_pool = true
  initial_node_count       = 1

  # Addons
  addons_config {
    http_load_balancing {
      disabled = false
    }
    horizontal_pod_autoscaling {
      disabled = false
    }
    network_policy_config {
      disabled = false
    }
  }

  # Workload Identity
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Maintenance window
  maintenance_policy {
    daily_maintenance_window {
      start_time = "03:00"
    }
  }
}

# Node Pool - General Purpose
resource "google_container_node_pool" "general" {
  name       = "general-pool"
  location   = var.region
  cluster    = google_container_cluster.ssl_cluster.name
  node_count = 2

  autoscaling {
    min_node_count = 2
    max_node_count = 10
  }

  node_config {
    machine_type = "e2-standard-4"
    disk_size_gb = 100
    disk_type    = "pd-ssd"

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    labels = {
      environment = var.environment
      pool        = "general"
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }
}

# Node Pool - High Memory (for scoring service)
resource "google_container_node_pool" "high_memory" {
  name       = "high-memory-pool"
  location   = var.region
  cluster    = google_container_cluster.ssl_cluster.name
  node_count = 1

  autoscaling {
    min_node_count = 1
    max_node_count = 5
  }

  node_config {
    machine_type = "e2-highmem-4"
    disk_size_gb = 100
    disk_type    = "pd-ssd"

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    labels = {
      environment = var.environment
      pool        = "high-memory"
    }

    taint {
      key    = "workload"
      value  = "high-memory"
      effect = "NO_SCHEDULE"
    }
  }
}

# Cloud SQL - PostgreSQL
resource "google_sql_database_instance" "ssl_postgres" {
  name             = "ssl-postgres-${var.environment}"
  database_version = "POSTGRES_17"
  region           = var.region

  settings {
    tier = var.environment == "prod" ? "db-custom-4-16384" : "db-custom-2-8192"

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.ssl_vpc.id
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "02:00"
    }

    maintenance_window {
      day  = 7
      hour = 3
    }

    database_flags {
      name  = "max_connections"
      value = "500"
    }
  }

  deletion_protection = var.environment == "prod"
}

# Redis - Memorystore
resource "google_redis_instance" "ssl_redis" {
  name           = "ssl-redis-${var.environment}"
  tier           = var.environment == "prod" ? "STANDARD_HA" : "BASIC"
  memory_size_gb = var.environment == "prod" ? 5 : 1
  region         = var.region

  authorized_network = google_compute_network.ssl_vpc.id

  redis_version = "REDIS_7_0"

  labels = {
    environment = var.environment
  }
}

# Outputs
output "cluster_name" {
  value = google_container_cluster.ssl_cluster.name
}

output "cluster_endpoint" {
  value     = google_container_cluster.ssl_cluster.endpoint
  sensitive = true
}

output "postgres_connection" {
  value     = google_sql_database_instance.ssl_postgres.connection_name
  sensitive = true
}

output "redis_host" {
  value = google_redis_instance.ssl_redis.host
}
