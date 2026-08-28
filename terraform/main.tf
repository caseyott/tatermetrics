################################################################################
# main.tf — Root configuration for tatermetrics.tatertech.net infrastructure
#
# Static hosting for tatermetrics.tatertech.net. The site itself is a plain
# S3 + CloudFront static site — every page, starting with mlb/, is
# client-side only and fetches its own data straight from public
# third-party APIs at request time. The one exception is the mlb_snapshot
# module below: a small Lambda that writes a daily MLB standings snapshot
# to S3, replacing a flaky GitHub Actions cron trigger.
################################################################################

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  backend "s3" {
    bucket  = "terraform-tatertech-state-bucket"
    key     = "tatermetrics/terraform.tfstate"
    region  = "us-east-2"
    encrypt = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

################################################################################
# Modules
################################################################################

module "s3" {
  source      = "./modules/s3"
  bucket_name = var.domain_name
}

module "cloudfront" {
  source              = "./modules/cloudfront"
  app_name            = var.app_name
  domain_name         = var.domain_name
  bucket_id           = module.s3.bucket_id
  bucket_arn          = module.s3.bucket_arn
  bucket_domain_name  = module.s3.bucket_regional_domain_name
  acm_certificate_arn = var.acm_certificate_arn
}

module "route53" {
  source                    = "./modules/route53"
  domain_name               = var.domain_name
  cloudfront_domain_name    = module.cloudfront.cloudfront_domain_name
  cloudfront_hosted_zone_id = module.cloudfront.cloudfront_hosted_zone_id
}

module "github_oidc" {
  source              = "./modules/github_oidc"
  github_repo         = var.github_repo
  s3_bucket_arn       = module.s3.bucket_arn
  cf_distribution_arn = module.cloudfront.cloudfront_distribution_arn
}

module "mlb_snapshot" {
  source              = "./modules/lambda_snapshot"
  app_name            = var.app_name
  s3_bucket_name      = module.s3.bucket_id
  s3_bucket_arn       = module.s3.bucket_arn
  cf_distribution_id  = module.cloudfront.cloudfront_distribution_id
  cf_distribution_arn = module.cloudfront.cloudfront_distribution_arn
  snapshot_prefix     = var.mlb_snapshot_prefix
  schedule_expression = var.mlb_snapshot_schedule
  schedule_timezone   = var.mlb_snapshot_timezone
}
