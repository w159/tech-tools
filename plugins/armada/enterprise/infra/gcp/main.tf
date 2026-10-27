terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "this" {
  project_id = var.project_id
}

resource "google_project_service" "apis" {
  for_each = toset(concat(
    ["run.googleapis.com", "secretmanager.googleapis.com", "logging.googleapis.com"],
    var.enable_firestore ? ["firestore.googleapis.com"] : []
  ))

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

locals {
  service_name = "${var.name_prefix}-gateway"

  # Secret Manager secrets the gateway reads as environment variables.
  gateway_secrets = merge(
    { AUDIT_HMAC_KEY = "${var.name_prefix}-audit-hmac-key" },
    var.gateway_mode == "broker" ? {
      BROKER_UPSTREAM_CLIENT_SECRET = "${var.name_prefix}-broker-upstream-client-secret"
      BROKER_SIGNING_JWKS           = "${var.name_prefix}-broker-signing-jwks"
      BROKER_COOKIE_KEYS            = "${var.name_prefix}-broker-cookie-keys"
    } : {},
    var.connector_secrets
  )

  policy_secret_id = "${var.name_prefix}-policy-yaml"

  all_secret_ids = toset(concat(values(local.gateway_secrets), [local.policy_secret_id]))

  # Cloud Run's deterministic service URL.
  default_base_url = "https://${local.service_name}-${data.google_project.this.number}.${var.region}.run.app"
  base_url         = var.public_base_url != "" ? var.public_base_url : local.default_base_url

  plain_env = merge(
    {
      GATEWAY_MODE    = var.gateway_mode
      PUBLIC_BASE_URL = local.base_url
      POLICY_FILE     = "/mnt/policy/policy.yaml"
    },
    var.extra_env
  )
}

resource "google_service_account" "gateway" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-gateway"
  display_name = "MCP gateway runtime"
}

# Secret containers only. Versions (the values) are added out of band so no
# secret value is in code or in Terraform state.
resource "google_secret_manager_secret" "secrets" {
  for_each = local.all_secret_ids

  project   = var.project_id
  secret_id = each.value
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each = local.all_secret_ids

  project   = var.project_id
  secret_id = google_secret_manager_secret.secrets[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.gateway.email}"
}

resource "google_cloud_run_v2_service" "gateway" {
  count = var.deploy_service ? 1 : 0

  project  = var.project_id
  name     = local.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  labels   = var.labels

  template {
    service_account = google_service_account.gateway.email

    scaling {
      # Stays at 1 until a persistent authorization-server state adapter
      # ships. The broker keeps sessions, codes and refresh tokens in process
      # memory, so a second instance would reject tokens the first one issued.
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        # Keep CPU allocated between requests: stdio backends run as child
        # processes and the audit log is written outside request handling.
        cpu_idle = false
      }

      dynamic "env" {
        for_each = local.plain_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.gateway_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secrets[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      volume_mounts {
        name       = "policy"
        mount_path = "/mnt/policy"
      }
    }

    volumes {
      name = "policy"
      secret {
        secret = google_secret_manager_secret.secrets[local.policy_secret_id].secret_id
        items {
          path    = "policy.yaml"
          version = "latest"
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.accessor,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.deploy_service && var.allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.gateway[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Optional state store for the future persistent adapter.
resource "google_firestore_database" "state" {
  count = var.enable_firestore ? 1 : 0

  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "firestore_user" {
  count = var.enable_firestore ? 1 : 0

  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.gateway.email}"
}
