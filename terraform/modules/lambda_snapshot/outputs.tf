output "function_name" {
  description = "Name of the MLB snapshot Lambda function."
  value       = aws_lambda_function.snapshot.function_name
}

output "function_arn" {
  description = "ARN of the MLB snapshot Lambda function."
  value       = aws_lambda_function.snapshot.arn
}

output "schedule_name" {
  description = "Name of the EventBridge Scheduler schedule that triggers the daily run."
  value       = aws_scheduler_schedule.daily.name
}
