################################################################################
# modules/github_oidc/main.tf
#
# IAM role GitHub Actions can assume (via OIDC) to deploy this site — no
# long-lived AWS access keys stored as GitHub secrets.
#
# This references the GitHub OIDC provider as a DATA SOURCE rather than
# creating it, because it's a single per-account resource and is expected to
# already exist (created by the curlingscorekeeper repo's terraform). If it
# does NOT exist yet in this account, create it once — e.g. from the
# curlingscorekeeper repo, or manually:
#   aws iam create-open-id-connect-provider \
#     --url https://token.actions.githubusercontent.com \
#     --client-id-list sts.amazonaws.com \
#     --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 1c58a3a8518e8759bf075b76b750d4f2df264fcd
################################################################################

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  # var.github_repo is "owner/repo". GitHub's OIDC "sub" claim now embeds the
  # numeric owner/repo IDs in that segment (e.g.
  # "repo:caseyott@33462988/tatermetrics@1347384109:ref:refs/heads/main"
  # instead of the older plain "repo:caseyott/tatermetrics:ref:...") — a
  # hardening change so a renamed/transferred repo doesn't inherit an old
  # trust relationship. We wildcard the "@<id>" part rather than hardcoding
  # the IDs so this doesn't silently break again if the exact format shifts.
  github_repo_owner = split("/", var.github_repo)[0]
  github_repo_name  = split("/", var.github_repo)[1]
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Any branch, PR, or workflow_dispatch in this repo may assume the role.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${local.github_repo_owner}@*/${local.github_repo_name}@*:*"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "tatermetrics-github-actions-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json
  description        = "Assumed by GitHub Actions to sync the site bucket and invalidate CloudFront"
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid    = "S3Sync"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = [
      var.s3_bucket_arn,
      "${var.s3_bucket_arn}/*",
    ]
  }

  statement {
    sid    = "CloudFrontInvalidation"
    effect = "Allow"
    actions = [
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
    ]
    resources = [var.cf_distribution_arn]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
