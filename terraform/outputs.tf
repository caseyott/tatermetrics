################################################################################
# outputs.tf — Root outputs surfaced after `terraform apply`
################################################################################

output "site_url" {
  description = "Public URL of the site."
  value       = "https://${var.domain_name}"
}

output "bucket_name" {
  description = "Name of the S3 bucket serving the site (upload files here, e.g. under mlb/)."
  value       = module.s3.bucket_id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — used for cache invalidation after deploys and set as the CF_DISTRIBUTION_ID GitHub Actions variable."
  value       = module.cloudfront.cloudfront_distribution_id
}

output "cloudfront_domain_name" {
  description = "Raw CloudFront domain (*.cloudfront.net)."
  value       = module.cloudfront.cloudfront_domain_name
}

output "github_oidc_deploy_role_arn" {
  description = "IAM role ARN GitHub Actions assumes to sync the bucket and invalidate CloudFront. Set as AWS_ROLE_ARN in the repo's GitHub Actions variables."
  value       = module.github_oidc.deploy_role_arn
}

output "mlb_snapshot_function_name" {
  description = "Name of the daily MLB snapshot Lambda function."
  value       = module.mlb_snapshot.function_name
}

output "mlb_snapshot_schedule_name" {
  description = "Name of the EventBridge Scheduler schedule that triggers the daily MLB snapshot."
  value       = module.mlb_snapshot.schedule_name
}
