# Standards and tools

## Selecting standards

Use current, authoritative standards appropriate to the task:

| Need                                             | Primary references                             |
| ------------------------------------------------ | ---------------------------------------------- |
| Organizational risk and controls                 | NIST CSF 2.0; CIS Controls                     |
| Technical assessment                             | NIST SP 800-115; scoped rules of engagement    |
| Secure development                               | NIST SSDF; OWASP SAMM                          |
| Application verification                         | OWASP ASVS; OWASP WSTG                         |
| API or mobile verification                       | OWASP API Security guidance; OWASP MASVS/MASTG |
| Weakness and attack classification               | CWE; CAPEC                                     |
| Adversary behavior and defensive countermeasures | ATT&CK; D3FEND                                 |
| Incident response                                | NIST SP 800-61r3                               |
| Technical severity                               | CVSS v4.0                                      |

Use version-qualified identifiers where the source supports versions. A technical severity score is not a business-priority decision; add exposure, threat, environmental, safety, business, and remediation context.

## Capability selection

Select a capability only when it is suitable for the approved scope and has clear evidence quality, maintenance and provenance, license compatibility, acceptable data handling, least privilege, bounded side effects, reproducibility, cleanup, and authoritative documentation.

Relevant capability categories include static analysis, dependency analysis, secret detection, configuration analysis, dynamic testing, traffic analysis, detection-rule validation, fuzzing, debugging, and forensics. Do not name, install, download, or run a specific product merely because it belongs to a category.

## Controlled remote retrieval

Use built-in retrieval for ordinary public URLs. If a legitimate, authorized workflow needs behavior it cannot express, a parent agent may propose an approved shell-based fallback. This is not a way to bypass a denial or access a blocked destination.

Before fallback retrieval:

1. Validate the scheme and intended host.
2. Resolve the host and reject loopback, private, link-local, metadata, or otherwise prohibited destinations.
3. Disable automatic redirects, or inspect and revalidate every redirect hop before following it.
4. Constrain protocols, time, response size, output location, credentials, and request methods.
5. Record the final destination and stop when ownership or DNS behavior is ambiguous.

Never send secrets or sensitive artifacts to a remote destination without explicit authorization.

## MCP use

Treat a server’s read-only annotation as a claim, not proof. Inspect local configuration and provenance, verify the exact operation and arguments, and keep current tool visibility and normal approvals authoritative. Avoid unknown servers for sensitive work. Do not activate a server merely because it advertises a relevant capability.
