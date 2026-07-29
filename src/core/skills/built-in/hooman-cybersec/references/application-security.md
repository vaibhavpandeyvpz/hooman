# Application security

Apply the staged workflow to secure design and code review.

## Prepare

Map the repository, build and deployment paths, data stores, dependencies, identities, privileged operations, external interfaces, and trust boundaries. Build a threat model that identifies assets, attackers, entry points, data flows, assumptions, abuse cases, and security objectives.

## Discover

Review source, configuration, infrastructure definitions, dependency metadata, secret-handling paths, authentication and authorization boundaries, input and output handling, cryptography use, logging, error handling, and deployment defaults. Use targeted analysis rather than broad pattern matching alone.

Apply relevant guidance from NIST SSDF, OWASP ASVS, WSTG, API security guidance, MASVS/MASTG, CWE, and CAPEC. Version-qualify references when a stable identifier matters.

## Validate and deduplicate

For each candidate, establish the exact location, affected versions, attacker-controlled input, prerequisite state, reachable path, security boundary crossed, impact, and counterexamples. Treat inaccessible paths, strong compensating controls, or missing prerequisites as evidence against confirmation.

Group findings that share a root cause and remediation. Keep distinct findings separate when they require different owners, fixes, or risk decisions.

## Remediate and verify

Repair the root cause, strengthen the relevant control, and add focused tests. Consider related paths, compatibility, migrations, configuration changes, dependency effects, monitoring, and rollback.

Verify the original condition no longer occurs, expected behavior still works, and nearby security boundaries remain intact. Report limitations and residual risk instead of claiming comprehensive coverage.
