variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "europe-north1"
}

variable "scheduler_region" {
  type        = string
  default     = "europe-west1"
  description = "Closest supported EU region because Cloud Scheduler is unavailable in europe-north1."
}

variable "environment" {
  type    = string
  default = "staging"
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}

variable "worker_image" {
  type = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.worker_image))
    error_message = "worker_image must be pinned to a sha256 digest"
  }
}

variable "notification_channel_id" {
  type = string
  validation {
    condition     = length(trimspace(var.notification_channel_id)) > 0
    error_message = "A Cloud Monitoring notification channel id is required"
  }
}

variable "supabase_url_secret_id" {
  type    = string
  default = "dfks-audit-supabase-url"
}

variable "supabase_service_role_secret_id" {
  type    = string
  default = "dfks-audit-supabase-service-role"
}

variable "worm_bucket_name" {
  type     = string
  default  = null
  nullable = true
}

variable "lock_worm_retention" {
  type    = bool
  default = false
  validation {
    condition     = !var.lock_worm_retention || var.environment == "production"
    error_message = "Bucket Lock may only be enabled in production"
  }
}

variable "enable_scheduler" {
  type    = bool
  default = false
}

variable "min_instances" {
  type    = number
  default = 0
}
