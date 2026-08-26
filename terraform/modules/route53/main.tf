################################################################################
# modules/route53/main.tf
#
# Route 53 alias records pointing domain_name at the CloudFront distribution.
# Assumes tatertech.net is already hosted in Route 53 in this account — no
# zone creation is performed here.
################################################################################

data "aws_route53_zone" "zone" {
  name         = "tatertech.net."
  private_zone = false
}

resource "aws_route53_record" "app_a" {
  zone_id = data.aws_route53_zone.zone.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "app_aaaa" {
  zone_id = data.aws_route53_zone.zone.zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}
