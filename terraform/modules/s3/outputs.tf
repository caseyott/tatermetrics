output "bucket_id" {
  description = "Name (ID) of the site bucket."
  value       = aws_s3_bucket.site.id
}

output "bucket_arn" {
  description = "ARN of the site bucket."
  value       = aws_s3_bucket.site.arn
}

output "bucket_regional_domain_name" {
  description = "Regional domain name of the site bucket (used as the CloudFront origin)."
  value       = aws_s3_bucket.site.bucket_regional_domain_name
}
