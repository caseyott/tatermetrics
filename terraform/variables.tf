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

variable "custom_domain_name" {
  description = "Apex custom domain for the site, registered at Cloudflare with DNS delegated to a new Route 53 hosted zone created by this config (see route53_com.tf). The site is served at both this domain and domain_name."
  type        = string
  default     = "tatermetrics.com"
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
