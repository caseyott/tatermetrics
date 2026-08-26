variable "app_name" {
  description = "Application name prefix."
  type        = string
}

variable "domain_name" {
  description = "Custom domain name for the CloudFront distribution."
  type        = string
}

variable "bucket_id" {
  description = "Name (ID) of the origin S3 bucket."
  type        = string
}

variable "bucket_arn" {
  description = "ARN of the origin S3 bucket."
  type        = string
}

variable "bucket_domain_name" {
  description = "Regional domain name of the origin S3 bucket."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ARN of an existing ACM certificate in us-east-1 covering domain_name."
  type        = string
}
