################################################################################
# modules/s3/main.tf
#
# Single private S3 bucket that serves as the CloudFront origin for the whole
# tatermetrics.tatertech.net site. Content is organized by subpage prefix
# inside the bucket (e.g. mlb/index.html for tatermetrics.tatertech.net/mlb/).
################################################################################

resource "aws_s3_bucket" "site" {
  bucket = var.bucket_name

  lifecycle {
    prevent_destroy = false
  }
}

# Block all public access — CloudFront's Origin Access Control is the only reader.
resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Versioning — cheap insurance against an accidental overwrite/delete on deploy.
resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id

  versioning_configuration {
    status = "Enabled"
  }
}
