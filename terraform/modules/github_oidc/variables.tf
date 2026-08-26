variable "github_repo" {
  description = "GitHub repository in 'owner/repo' format."
  type        = string
}

variable "s3_bucket_arn" {
  description = "ARN of the site's S3 bucket."
  type        = string
}

variable "cf_distribution_arn" {
  description = "ARN of the site's CloudFront distribution."
  type        = string
}
