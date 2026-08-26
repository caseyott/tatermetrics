// CloudFront Function (viewer request)
//
// Rewrites extensionless URIs to their directory's index.html so that
// sub-site paths like /mlb and /mlb/ resolve to /mlb/index.html on the
// origin, matching the S3 key layout (mlb/index.html, nba/index.html, ...).
function handler(event) {
    var request = event.request;
    var uri = request.uri;

    if (uri.endsWith("/")) {
        // /mlb/ -> /mlb/index.html
        request.uri += "index.html";
    } else if (!uri.includes(".")) {
        // /mlb -> /mlb/index.html
        request.uri += "/index.html";
    }

    return request;
}
