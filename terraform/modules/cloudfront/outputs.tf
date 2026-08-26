output "cloudfront_domain_name" {
  description = "Bare AWS-assigned domain name of the CloudFront distribution (*.cloudfront.net)."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "cloudfront_hosted_zone_id" {
  description = "Hosted zone ID for the CloudFront distribution — used for Route 53 alias records."
  value       = aws_cloudfront_distribution.site.hosted_zone_id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — used for cache invalidation."
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_distribution_arn" {
  description = "ARN of the CloudFront distribution — used in IAM policies."
  value       = aws_cloudfront_distribution.site.arn
}
