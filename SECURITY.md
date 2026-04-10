# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AgentSentry, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. **GitHub Security Advisories (preferred):** Use [GitHub's private vulnerability reporting](https://github.com/calabamatex/AgentSentry/security/advisories/new) to submit a report directly through GitHub.

2. **Email:** Send details to the repository maintainers via GitHub.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 1 week
- **Fix timeline:** Depends on severity
  - Critical: Within 72 hours
  - High: Within 1 week
  - Medium/Low: Next release cycle

### Supported Versions

| Version | Supported |
|---------|-----------|
| 0.5.x   | Yes       |
| < 0.5   | No        |

## Security Features

AgentSentry includes built-in security capabilities:

- **Secret Detection:** Scans for 15 types of hardcoded credentials (API keys, tokens, connection strings, JWTs)
- **PII Scanner:** Detects 15 categories of personally identifiable information in logging statements
- **Dashboard Authentication:** Token-based access control for the monitoring dashboard
- **Hash-Chained Audit Log:** Tamper-evident event storage with SHA-256 chain verification
- **Permission Enforcement:** File-level and command-level allowlist/denylist

## Known Security Considerations

- The MCP server accepts all requests by default when `AGENT_SENTRY_ACCESS_KEY` is not set. Set `AGENT_SENTRY_REQUIRE_AUTH=true` for network-exposed deployments.
- The Supabase provider is experimental and should not be used in production environments.
- Vector search data is stored unencrypted in local SQLite. Use filesystem-level encryption for sensitive environments.
