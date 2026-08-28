################################################################################
# modules/lambda_snapshot/main.tf
#
# Runs mlb/scripts/lambda/index.js (+ mlb/scripts/lib/standings.js) once a
# day via EventBridge Scheduler — replaces the GitHub Actions cron trigger
# in .github/workflows/mlb-snapshot.yml, which was unreliable about firing
# at all (GitHub's shared-runner scheduler can silently drop a scheduled
# run, especially the first one after a workflow/schedule change).
#
# No node_modules in the deployment package: @aws-sdk/client-s3 and
# @aws-sdk/client-cloudfront ship built into the Node.js 20.x Lambda
# runtime, so the zip is just the two source files.
################################################################################

data "archive_file" "snapshot" {
  type        = "zip"
  output_path = "${path.module}/build/snapshot-lambda.zip"

  source {
    content  = file("${path.module}/../../../mlb/scripts/lambda/index.js")
    filename = "index.js"
  }

  source {
    content  = file("${path.module}/../../../mlb/scripts/lib/standings.js")
    filename = "lib/standings.js"
  }
}

################################################################################
# Lambda execution role
################################################################################

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${var.app_name}-mlb-snapshot-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
  description        = "Executed by the ${var.app_name} MLB snapshot Lambda"
}

data "aws_iam_policy_document" "lambda_exec" {
  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.snapshot.arn}:*"]
  }

  statement {
    sid       = "S3Write"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${var.s3_bucket_arn}/${var.snapshot_prefix}/*"]
  }

  statement {
    sid       = "CloudFrontInvalidation"
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [var.cf_distribution_arn]
  }
}

resource "aws_iam_role_policy" "lambda_exec" {
  name   = "snapshot"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_exec.json
}

resource "aws_cloudwatch_log_group" "snapshot" {
  name              = "/aws/lambda/${var.app_name}-mlb-snapshot"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "snapshot" {
  function_name    = "${var.app_name}-mlb-snapshot"
  description      = "Writes the daily MLB standings snapshot to S3 and invalidates CloudFront"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 15
  memory_size      = 128
  filename         = data.archive_file.snapshot.output_path
  source_code_hash = data.archive_file.snapshot.output_base64sha256

  environment {
    variables = {
      BUCKET_NAME        = var.s3_bucket_name
      SNAPSHOT_PREFIX    = var.snapshot_prefix
      CF_DISTRIBUTION_ID = var.cf_distribution_id
    }
  }

  depends_on = [aws_cloudwatch_log_group.snapshot]
}

################################################################################
# EventBridge Scheduler — daily trigger
################################################################################

data "aws_iam_policy_document" "scheduler_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.app_name}-mlb-snapshot-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
  description        = "Assumed by EventBridge Scheduler to invoke the ${var.app_name} MLB snapshot Lambda"
}

data "aws_iam_policy_document" "scheduler_invoke" {
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.snapshot.arn]
  }
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name   = "invoke-snapshot"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_invoke.json
}

resource "aws_scheduler_schedule" "daily" {
  name                = "${var.app_name}-mlb-snapshot-daily"
  schedule_expression = var.schedule_expression

  # A named timezone means DST is handled automatically — the old GitHub
  # Actions cron had to be hand-edited twice a year to stay at 5:15am ET.
  schedule_expression_timezone = var.schedule_timezone

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.snapshot.arn
    role_arn = aws_iam_role.scheduler.arn
  }
}
