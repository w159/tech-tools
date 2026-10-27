output "service_account_email" {
  description = "Runtime service account of the gateway."
  value       = google_service_account.gateway.email
}

output "gateway_base_url" {
  description = "Public origin the gateway is configured with. Register this with the identity provider."
  value       = local.base_url
}

output "required_secret_ids" {
  description = "Secret Manager secrets that need a version before the service is deployed."
  value       = sort(tolist(local.all_secret_ids))
}

output "cloud_run_url" {
  description = "URL reported by Cloud Run, empty until deploy_service is true."
  value       = var.deploy_service ? google_cloud_run_v2_service.gateway[0].uri : ""
}
