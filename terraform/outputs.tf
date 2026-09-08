################################################################################
# outputs.tf — Root outputs surfaced after `terraform apply`
################################################################################

output "site_url" {
  description = "Public URL of the site."
  value       = "https://${var.domain_name}"
}

output "custom_domain_url" {
  description = "Public URL of the site on its apex custom domain."
  value       = "https://${var.custom_domain_name}"
}

output "cloudflare_dns_records_created" {
  description = "DNS records this config manages directly in Cloudflare (tatermetrics.com stays on Cloudflare nameservers per Cloudflare Registrar's requirement, so its records live there instead of in Route 53)."
  value = [
    cloudflare_dns_record.apex.name,
    cloudflare_dns_record.www.name,
  ]
}

output "acm_certificate_arn" {
  description = "ARN of the ACM certificate covering tatermetrics.com, www.tatermetrics.com, and tatermetrics.tatertech.net."
  value       = aws_acm_certificate_validation.site.certificate_arn
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
