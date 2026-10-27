variable "project_id" {
  description = "Google Cloud project that hosts the gateway."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run and Firestore, for example us-central1."
  type        = string
}

variable "name_prefix" {
  description = "Short prefix for resource names, lowercase letters, digits and hyphens."
  type        = string
  default     = "mcpgw"
}

variable "image" {
  description = "Full image reference in Artifact Registry, for example us-central1-docker.pkg.dev/PROJECT/REPO/mcp-gateway:1."
  type        = string
}

variable "deploy_service" {
  description = "Pass 1 leaves this false and creates the service account and empty secrets. Set true after every secret has a version."
  type        = bool
  default     = false
}

variable "gateway_mode" {
  description = "Gateway mode: broker or direct."
  type        = string
  default     = "broker"

  validation {
    condition     = contains(["broker", "direct"], var.gateway_mode)
    error_message = "gateway_mode must be broker or direct."
  }
}

variable "public_base_url" {
  description = "Public https origin of the gateway, no path. Empty uses the deterministic Cloud Run URL."
  type        = string
  default     = ""
}

variable "extra_env" {
  description = "Non-secret environment variables for the IdP and gateway, for example BROKER_UPSTREAM_ISSUER."
  type        = map(string)
  default     = {}
}

variable "connector_secrets" {
  description = "Connector credentials. Map of environment variable name to Secret Manager secret id. Values are added to Secret Manager by the admin, never here."
  type        = map(string)
  default     = {}
}

variable "allow_unauthenticated" {
  description = "Grant roles/run.invoker to allUsers. The gateway authenticates callers itself, so this is normally true. Set false if an organization policy blocks it and put a load balancer in front."
  type        = bool
  default     = true
}

variable "enable_firestore" {
  description = "Create a Firestore (native mode) database for the future persistent state adapter. Not wired to the gateway yet."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Labels applied to supported resources."
  type        = map(string)
  default     = {}
}
