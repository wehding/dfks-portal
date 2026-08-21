terraform {
  required_version = ">= 1.7.0"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 7.0" }
    time   = { source = "hashicorp/time", version = "~> 0.13" }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
