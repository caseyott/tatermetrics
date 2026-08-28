variable "app_name" {
  description = "Short application name used as a prefix for resource names."
  type        = string
}

variable "s3_bucket_name" {
  description = "Name of the site's S3 bucket (set as the Lambda's BUCKET_NAME env var)."
  type        = string
}

variable "s3_bucket_arn" {
  description = "ARN of the site's S3 bucket."
  type        = string
}

variable "cf_distribution_id" {
  description = "CloudFront distribution ID (set as the Lambda's CF_DISTRIBUTION_ID env var; the function invalidates it after each upload)."
  type        = string
}

variable "cf_distribution_arn" {
  description = "ARN of the CloudFront distribution."
  type        = string
}

variable "snapshot_prefix" {
  description = "S3 key prefix snapshots are written under, e.g. \"mlb/data\" (set as the Lambda's SNAPSHOT_PREFIX env var)."
  type        = string
  default     = "mlb/data"
}

variable "schedule_expression" {
  description = "EventBridge Scheduler cron/rate expression for the daily run."
  type        = string
  default     = "cron(15 5 * * ? *)"
}

variable "schedule_timezone" {
  description = "IANA timezone the schedule_expression is evaluated in. Using a named timezone (rather than UTC) means DST transitions are handled automatically — no manual cron math twice a year."
  type        = string
  default     = "America/New_York"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the function's log group."
  type        = number
  default     = 14
}
