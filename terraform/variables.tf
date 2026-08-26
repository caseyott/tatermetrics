################################################################################
# variables.tf — Root input variables
################################################################################

variable "region" {
  description = "AWS region to deploy all resources into (ACM cert for CloudFront must be us-east-1)."
  type        = string
  default     = "us-east-1"
}

variable "app_name" {
  description = "Short application name used as a prefix for resource names."
  type        = string
  default     = "tatermetrics"
}

variable "environment" {
  description = "Deployment environment tag."
  type        = string
  default     = "prod"
}

variable "domain_name" {
  description = "Custom domain name for the site. Also used as the S3 bucket name."
  type        = string
  default     = "tatermetrics.tatertech.net"
}

variable "acm_certificate_arn" {
  description = "ARN of the existing ACM wildcard cert for *.tatertech.net in us-east-1 (shared with curling.tatertech.net)."
  type        = string
  default     = "arn:aws:acm:us-east-1:461752900329:certificate/fd48e251-fc42-4e16-85b0-68f3cc581ac0"
}

variable "github_repo" {
  description = "GitHub repository in 'owner/repo' format, used to scope the OIDC deploy role's trust policy."
  type        = string
  default     = "caseyott/tatermetrics"
}
