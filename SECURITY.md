# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| Latest (`main`) | Yes |
| Older releases | No |

We only maintain the latest release. If you find a vulnerability, please report it and we will issue a patch release.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately via [GitHub's private vulnerability reporting](https://github.com/talktoajayprakash/skillsmanager/security/advisories/new), or email the maintainer directly at the address in `package.json`.

Please include:
- A clear description of the issue
- Steps to reproduce
- Potential impact
- Any suggested mitigations (optional)

## Response timeline

- **Acknowledgement**: within 48 hours
- **Initial assessment**: within 5 business days
- **Patch for critical issues**: within 14 days of confirmation

## Scope

Skills Manager is a CLI tool with no server component. The main security-relevant areas are:

- **OAuth token storage** — tokens are stored at `~/.skillsmanager/token.json` with file-system permissions
- **Google Drive API access** — uses the `drive` scope (full Drive access) because Skills Manager needs to discover `SKILLS_REGISTRY.yaml` and `SKILLS_COLLECTION.yaml` files across your entire Drive, including files not created by the app (e.g. shared collections, manually created registries). The narrower `drive.file` scope would prevent discovery from working.
- **Skill content execution** — Skills Manager does not execute skill files; it only reads and symlinks them. Execution is handled by the target agent.

Out of scope: social engineering, phishing, issues in third-party dependencies that have already been publicly disclosed.
