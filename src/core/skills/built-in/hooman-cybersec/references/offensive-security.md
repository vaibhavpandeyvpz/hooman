# Authorized offensive security

Use this guidance only after the authorization and safety requirements are satisfied.

## Method

1. **Pre-engagement** — confirm scope, contacts, permitted methods, testing accounts, data constraints, success criteria, and stop conditions.
2. **Intelligence gathering** — inventory only approved assets and attack surface. Prefer passive or owner-provided information before active interaction.
3. **Threat modeling** — identify trust boundaries, entry points, identities, privileged actions, sensitive data flows, and abuse cases.
4. **Vulnerability analysis** — form a specific hypothesis, capture prerequisites, and identify the minimum evidence that could validate or refute it.
5. **Controlled validation** — use the smallest practical test, a bounded rate, and approved test accounts or data. Avoid chaining issues unless explicitly authorized.
6. **Post-validation** — stop once the claimed condition is established, remove test artifacts, restore state, and record impact without extending it.
7. **Reporting** — provide reproducible, sanitized evidence and remediation guidance.

## Domain considerations

Apply the same method to applications and APIs, networks, identity systems, cloud services, containers or orchestration, mobile clients, and source-assisted reviews. Adapt evidence to the asset type, but do not widen scope because a dependency or adjacent service is discovered.

For each hypothesis, state the affected asset, required access, user interaction, trust boundary, likely impact, safety limit, expected signal, and rollback path. Validate only the claim needed for the report.

## Tool selection

Choose capabilities, not a fixed catalog. Evaluate whether a capability is appropriate for the target, produces reviewable evidence, respects authorization, minimizes privileges and data egress, has bounded side effects, supports reproducibility and cleanup, and is documented by its maintainer.

Do not install or run a capability solely because it is commonly used in assessments. If its behavior, data handling, or side effects are uncertain, do not use it.

## Reporting baseline

Map weakness classes and attack patterns only when doing so improves remediation. Use a technical severity vector and score when appropriate, then separately assess environmental exposure, business impact, exploit maturity, and remediation priority. A proof must not contain secrets, production data, or instructions that increase misuse potential.
