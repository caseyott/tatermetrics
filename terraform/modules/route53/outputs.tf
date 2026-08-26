output "fqdn" {
  description = "Fully-qualified domain name of the created Route 53 record."
  value       = aws_route53_record.app_a.fqdn
}
