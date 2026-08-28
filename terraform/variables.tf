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

variable "mlb_snapshot_prefix" {
  description = "S3 key prefix the daily MLB snapshot Lambda writes under."
  type        = string
  default     = "mlb/data"
}

variable "mlb_snapshot_schedule" {
  description = "EventBridge Scheduler cron expression for the daily MLB snapshot (evaluated in mlb_snapshot_timezone, not UTC)."
  type        = string
  default     = "cron(15 5 * * ? *)"
}

variable "mlb_snapshot_timezone" {
  description = "IANA timezone the MLB snapshot schedule is evaluated in."
  type        = string
  default     = "America/New_York"
}
