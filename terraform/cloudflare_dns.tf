################################################################################
# cloudflare_dns.tf — DNS records for tatermetrics.com, in Cloudflare
#
# tatermetrics.com is registered through Cloudflare Registrar, which requires
# the domain to stay on Cloudflare's own nameservers — third-party
# nameservers (including a Route 53 hosted zone) aren't permitted. Cloudflare's
# "multi-provider DNS" zone setting doesn't change that: it only stops
# Cloudflare from complaining when a registrar OTHER than Cloudflare lists a
# mix of nameservers. Since Cloudflare is both the registrar and the DNS host
# here, DNS for this domain has to stay in Cloudflare rather than move to
# Route 53.
#
# These records point the apex and www at the same CloudFront distribution
# that already serves tatermetrics.tatertech.net (see acm.tf for the
# certificate covering all three names, and main.tf for how they're wired
# into one CloudFront distribution).
################################################################################

variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS edit permission scoped to the tatermetrics.com zone. Set via the CLOUDFLARE_API_TOKEN env var or TF_VAR_cloudflare_api_token — never hardcode it here."
  type        = string
  sensitive   = true
  default     = null
}

data "cloudflare_zones" "tatermetrics_com" {
  name = var.custom_domain_name
}

locals {
  cloudflare_zone_id = data.cloudflare_zones.tatermetrics_com.result[0].id
}

resource "cloudflare_dns_record" "apex" {
  zone_id = local.cloudflare_zone_id
  name    = "@"
  type    = "CNAME"
  content = module.cloudfront.cloudfront_domain_name
  ttl     = 300
  proxied = false # DNS-only: CloudFront serves the site and terminates TLS, not Cloudflare's proxy.
  comment = "Apex -> CloudFront (tatermetrics static site). CNAME flattening applies automatically at the apex."
}

resource "cloudflare_dns_record" "www" {
  zone_id = local.cloudflare_zone_id
  name    = "www"
  type    = "CNAME"
  content = module.cloudfront.cloudfront_domain_name
  ttl     = 300
  proxied = false
  comment = "www -> CloudFront (tatermetrics static site)."
}
