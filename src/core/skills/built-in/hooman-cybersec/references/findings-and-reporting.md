# Findings and reporting

## Finding schema

For every finding, record:

- title and status: confirmed, likely, informational, false positive, accepted risk, or unresolved;
- affected assets, versions, owners, and scope;
- evidence, source, collection time, and integrity details where relevant;
- preconditions, reachability, safe reproduction, and counterevidence;
- impact, weakness classification, technical severity vector and score, and environmental priority;
- relevant standards or behavior mappings when they clarify the issue;
- remediation, verification steps, dependencies, rollback, residual risk, and confidence.

Do not use a severity label without explaining the evidence and assumptions behind it. Do not expose secrets, private data, or unsafe reproduction details.

## Report structure

1. Executive summary: scope, material risks, priorities, and decisions needed.
2. Scope and limitations: assets, methods, dates, exclusions, assumptions, and coverage gaps.
3. Findings: use the schema above and group duplicates by root cause.
4. Remediation plan: owner, priority, expected control outcome, validation, and target date.
5. Technical appendix: sanitized artifacts, hashes, evidence references, and deduplication rationale.
6. Disclosure and follow-up: approved audience, handling restrictions, escalation path, and retest plan.

Separate confirmed findings from hypotheses, informational observations, and unresolved questions. State what would increase or reduce confidence. Use responsible disclosure procedures for vulnerabilities affecting third parties.
