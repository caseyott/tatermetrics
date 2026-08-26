variable "domain_name" {
  description = "Fully-qualified domain name to create (e.g. tatermetrics.tatertech.net)."
  type        = string
}

variable "cloudfront_domain_name" {
  description = "AWS-assigned CloudFront domain name (*.cloudfront.net) — alias target."
  type        = string
}

variable "cloudfront_hosted_zone_id" {
  description = "Hosted zone ID of the CloudFront distribution — required for alias records."
  type        = string
}
