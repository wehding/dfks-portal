locals {
  service_name = "dfks-audit-siem-worker"
  worm_bucket  = coalesce(var.worm_bucket_name, "dfks-audit-worm-${var.project_id}")
  apis = toset([
    "artifactregistry.googleapis.com", "cloudkms.googleapis.com", "run.googleapis.com",
    "cloudscheduler.googleapis.com", "logging.googleapis.com", "monitoring.googleapis.com",
    "secretmanager.googleapis.com", "storage.googleapis.com",
  ])
  worker_member    = "serviceAccount:${google_service_account.worker.email}"
  scheduler_member = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_project_service" "required" {
  for_each           = local.apis
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "worker" {
  location      = var.region
  repository_id = "dfks-audit-workers"
  format        = "DOCKER"
  depends_on    = [google_project_service.required]
}

resource "google_service_account" "worker" {
  account_id   = "dfks-audit-worker"
  display_name = "DFKS audit WORM worker"
}

resource "google_service_account" "scheduler" {
  account_id   = "dfks-audit-scheduler"
  display_name = "DFKS audit Scheduler invoker"
}

resource "google_kms_key_ring" "audit" {
  name       = "dfks-audit"
  location   = var.region
  depends_on = [google_project_service.required]
}

resource "google_kms_crypto_key" "signing" {
  name     = "audit-signing"
  key_ring = google_kms_key_ring.audit.id
  purpose  = "ASYMMETRIC_SIGN"
  version_template {
    algorithm        = "EC_SIGN_P256_SHA256"
    protection_level = "SOFTWARE"
  }
  lifecycle { prevent_destroy = true }
}

resource "google_kms_crypto_key_iam_member" "worker_signer" {
  crypto_key_id = google_kms_crypto_key.signing.id
  role          = "roles/cloudkms.signerVerifier"
  member        = local.worker_member
}

resource "google_storage_bucket" "worm" {
  name                        = local.worm_bucket
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  retention_policy {
    retention_period = 220752000
    is_locked        = var.lock_worm_retention
  }
  lifecycle_rule {
    condition { age = 30 }
    action {
      type          = "SetStorageClass"
      storage_class = "ARCHIVE"
    }
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}

resource "google_project_iam_custom_role" "worm_evidence_writer" {
  role_id     = "dfksAuditWormEvidenceWriter"
  title       = "DFKS Audit WORM Evidence Writer"
  description = "Create evidence and read it back for integrity verification; no update or delete permissions."
  permissions = ["storage.objects.create", "storage.objects.get", "storage.objects.list"]
}

resource "google_storage_bucket_iam_member" "worker_worm" {
  bucket = google_storage_bucket.worm.name
  role   = google_project_iam_custom_role.worm_evidence_writer.name
  member = local.worker_member
}

resource "google_project_iam_member" "worker_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = local.worker_member
}

data "google_secret_manager_secret" "supabase_url" { secret_id = var.supabase_url_secret_id }
data "google_secret_manager_secret" "supabase_service_role" { secret_id = var.supabase_service_role_secret_id }

resource "google_secret_manager_secret_iam_member" "worker_supabase_url" {
  secret_id = data.google_secret_manager_secret.supabase_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.worker_member
}

resource "google_secret_manager_secret_iam_member" "worker_supabase_service_role" {
  secret_id = data.google_secret_manager_secret.supabase_service_role.id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.worker_member
}

resource "google_cloud_run_v2_service" "worker" {
  name                = local.service_name
  location            = var.region
  deletion_protection = var.environment == "production"
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  template {
    service_account = google_service_account.worker.email
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = 3
    }
    timeout = "300s"
    containers {
      image = var.worker_image
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      env {
        name  = "AUDIT_WORM_BUCKET"
        value = google_storage_bucket.worm.name
      }
      env {
        name  = "GOOGLE_CLOUD_KMS_KEY_NAME"
        value = "${google_kms_crypto_key.signing.id}/cryptoKeyVersions/1"
      }
      env {
        name  = "IMAGE_DIGEST"
        value = regex("sha256:[0-9a-f]{64}$", var.worker_image)
      }
      env {
        name  = "SIEM_BATCH_SIZE"
        value = "100"
      }
      env {
        name = "SUPABASE_URL"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.supabase_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "SUPABASE_SERVICE_ROLE_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.supabase_service_role.secret_id
            version = "latest"
          }
        }
      }
    }
  }
  lifecycle {
    precondition {
      condition     = can(regex("@sha256:[0-9a-f]{64}$", var.worker_image))
      error_message = "Cloud Run must be deployed from an immutable image digest"
    }
  }
  depends_on = [google_project_service.required, google_secret_manager_secret_iam_member.worker_supabase_url, google_secret_manager_secret_iam_member.worker_supabase_service_role]
}

resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = local.scheduler_member
}

resource "google_cloud_scheduler_job" "delivery" {
  name             = "dfks-audit-delivery"
  region           = var.scheduler_region
  schedule         = "*/5 * * * *"
  time_zone        = "Etc/UTC"
  paused           = !var.enable_scheduler
  attempt_deadline = "300s"
  retry_config {
    retry_count          = 3
    min_backoff_duration = "15s"
    max_backoff_duration = "300s"
    max_doublings        = 3
  }
  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/run"
    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.scheduler_invoker]
}

resource "google_cloud_scheduler_job" "retention_signing" {
  name             = "dfks-audit-retention-signing"
  region           = var.scheduler_region
  schedule         = "*/5 * * * *"
  time_zone        = "Etc/UTC"
  paused           = !var.enable_scheduler
  attempt_deadline = "300s"
  retry_config {
    retry_count          = 3
    min_backoff_duration = "15s"
    max_backoff_duration = "300s"
    max_doublings        = 3
  }
  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/sign-retention"
    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.scheduler_invoker]
}

resource "google_cloud_scheduler_job" "verification" {
  name             = "dfks-audit-daily-verification"
  region           = var.scheduler_region
  schedule         = "23 2 * * *"
  time_zone        = "Etc/UTC"
  paused           = !var.enable_scheduler
  attempt_deadline = "300s"
  retry_config {
    retry_count          = 2
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
  }
  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/verify"
    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.worker.uri
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.scheduler_invoker]
}

resource "google_logging_metric" "integrity_failure" {
  name   = "dfks_audit_integrity_failure"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.service_name}\" AND jsonPayload.event=\"audit_integrity_failure\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "delivery_failure" {
  name   = "dfks_audit_delivery_failure"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.service_name}\" AND (jsonPayload.event=\"audit_batch_delivery_failed\" OR jsonPayload.event=\"audit_retention_signing_failed\")"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "operational_failure" {
  name   = "dfks_audit_operational_failure"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.service_name}\" AND (jsonPayload.event=\"audit_sequence_break\" OR jsonPayload.event=\"audit_signature_invalid\" OR jsonPayload.event=\"audit_worm_receipt_missing\" OR jsonPayload.event=\"audit_dead_letter_present\" OR jsonPayload.event=\"audit_queue_stale\" OR jsonPayload.event=\"audit_retention_signature_stale\")"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

# Cloud Monitoring can reject policies immediately after a new log-based
# metric is created. Wait for the metric descriptors on a clean project.
resource "time_sleep" "logging_metric_propagation" {
  create_duration = "120s"
  depends_on = [
    google_logging_metric.integrity_failure,
    google_logging_metric.delivery_failure,
    google_logging_metric.operational_failure,
  ]
}

resource "google_monitoring_alert_policy" "integrity" {
  display_name          = "DFKS audit: sekvens-, hash-, signatur- eller WORM-fejl"
  combiner              = "OR"
  notification_channels = [var.notification_channel_id]
  conditions {
    display_name = "Integrity failures"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.integrity_failure.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  alert_strategy { auto_close = "604800s" }
  depends_on = [time_sleep.logging_metric_propagation]
}

resource "google_monitoring_alert_policy" "delivery" {
  display_name          = "DFKS audit: levering eller slettecertifikatsignering fejler"
  combiner              = "OR"
  notification_channels = [var.notification_channel_id]
  conditions {
    display_name = "Delivery failures"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.delivery_failure.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  alert_strategy { auto_close = "604800s" }
  depends_on = [time_sleep.logging_metric_propagation]
}

resource "google_monitoring_alert_policy" "operational" {
  display_name          = "DFKS audit: kø, dead-letter, WORM eller signatur kræver handling"
  combiner              = "OR"
  notification_channels = [var.notification_channel_id]
  conditions {
    display_name = "Operational audit evidence failures"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.operational_failure.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  alert_strategy { auto_close = "604800s" }
  depends_on = [time_sleep.logging_metric_propagation]
}

resource "google_monitoring_alert_policy" "worker_absent" {
  display_name          = "DFKS audit: worker har ikke svaret i 15 minutter"
  combiner              = "OR"
  notification_channels = [var.notification_channel_id]
  conditions {
    display_name = "No Cloud Run requests"
    condition_absent {
      filter   = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.service_name}\""
      duration = "900s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }
    }
  }
  documentation {
    content   = "Kontrollér Cloud Scheduler-job, aktiv Cloud Run-revision og OIDC/IAM. Alarmen evalueres samlet for servicen, så gamle revisioner og tidligere statuskoder ikke udløser separate fraværsalarmer. Pausér politikken eksplicit under planlagt Scheduler-pause."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_dashboard" "audit" {
  dashboard_json = jsonencode({
    displayName = "DFKS C-579/21 auditdrift"
    mosaicLayout = { columns = 12, tiles = [
      { xPos = 0, yPos = 0, width = 6, height = 4, widget = { title = "Cloud Run-kald", xyChart = { dataSets = [{ timeSeriesQuery = { timeSeriesFilter = { filter = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"${local.service_name}\"", aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_RATE" } } }, plotType = "LINE" }], timeshiftDuration = "0s", yAxis = { label = "kald/s", scale = "LINEAR" } } } },
      { xPos = 6, yPos = 0, width = 6, height = 4, widget = { title = "Integritetsfejl", scorecard = { timeSeriesQuery = { timeSeriesFilter = { filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.integrity_failure.name}\" AND resource.type=\"cloud_run_revision\"", aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_SUM" } } } } } },
    ] }
  })
}
