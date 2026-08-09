export function portfolioHtmlSecurityHeaders(hsts: boolean): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {
    'content-security-policy': "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  }
  if (hsts) {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains'
  }
  return Object.freeze(headers)
}

