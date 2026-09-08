################################################################################
# acm.tf — Certificate covering both domains the site is served on
#
# CloudFront needs a single us-east-1 ACM cert whose names cover every
# alias on the distribution. The site answers on three names —
# tatermetrics.com, www.tatermetrics.com, and the original
# tatermetrics.tatertech.net — so this requests one cert with all three and
# validates it via DNS. Each validation record has to land in whichever DNS
# provider actually hosts that name: tatertech.net stays in the existing
# Route 53 zone, while tatermetrics.com and www live in Cloudflare (see
# cloudflare_dns.tf for why — Cloudflare Registrar requires the domain to
# stay on Cloudflare nameservers).
#
# This replaces the previous approach of reusing the shared
# *.tatertech.net wildcard cert, since that cert doesn't cover
# tatermetrics.com.
################################################################################

resource "aws_acm_certificate" "site" {
  domain_name               = var.custom_domain_name
  subject_alternative_names = ["www.${var.custom_domain_name}", var.domain_name]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Existing zone for the tatertech.net subdomain the site already runs on —
# needed here so the ACM validation record for tatermetrics.tatertech.net
# can be created alongside it.
data "aws_route53_zone" "tatertech" {
  name         = "tatertech.net."
  private_zone = false
}

locals {
  cert_dvo_by_domain = {
    for dvo in aws_acm_certificate.site.domain_validation_options : dvo.domain_name => dvo
  }

  # tatermetrics.tatertech.net validates in Route 53; tatermetrics.com and
  # www.tatermetrics.com validate in Cloudflare.
  cert_dvo_route53    = { for k, v in local.cert_dvo_by_domain : k => v if endswith(k, "tatertech.net") }
  cert_dvo_cloudflare = { for k, v in local.cert_dvo_by_domain : k => v if !endswith(k, "tatertech.net") }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.cert_dvo_route53

  zone_id         = data.aws_route53_zone.tatertech.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 60
  allow_overwrite = true
}

resource "cloudflare_dns_record" "cert_validation" {
  for_each = local.cert_dvo_cloudflare

  zone_id = local.cloudflare_zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  content = each.value.resource_record_value
  ttl     = 60
  proxied = false
}

resource "aws_acm_certificate_validation" "site" {
  certificate_arn = aws_acm_certificate.site.arn

  # Pulled straight from the cert's own validation options rather than the
  # created records' attributes, since those records now live behind two
  # different providers (aws_route53_record exposes .fqdn; cloudflare_dns_record
  # doesn't) but both were created from these same names.
  validation_record_fqdns = [for dvo in aws_acm_certificate.site.domain_validation_options : dvo.resource_record_name]

  depends_on = [
    aws_route53_record.cert_validation,
    cloudflare_dns_record.cert_validation,
  ]
}
