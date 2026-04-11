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

## MCP Server Authentication

As of v0.6.0, the MCP server **requires authentication by default** and rejects all requests unless `AGENT_SENTRY_ACCESS_KEY` is set.

- **Production / network-exposed:** set `AGENT_SENTRY_ACCESS_KEY` to a strong random value (e.g., `openssl rand -hex 32`).
- **Local development only:** set `AGENT_SENTRY_NO_AUTH=true` to disable authentication. This emits a stderr warning on every startup and should never be used in production.
- The deprecated `AGENT_SENTRY_REQUIRE_AUTH` variable has been removed.

## Known Security Considerations

- The Supabase provider is experimental and should not be used in production environments.
- Vector search data is stored unencrypted in local SQLite. Use filesystem-level encryption for sensitive environments.
