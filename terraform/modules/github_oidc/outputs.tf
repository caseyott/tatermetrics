output "deploy_role_arn" {
  description = "ARN of the IAM role for GitHub Actions deployments."
  value       = aws_iam_role.deploy.arn
}
