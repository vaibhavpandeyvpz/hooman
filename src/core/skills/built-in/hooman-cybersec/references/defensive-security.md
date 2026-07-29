# Defensive security

Organize defensive work around governance, asset and risk understanding, protection, detection, response, and recovery. Use current authoritative frameworks as applicable, including NIST CSF 2.0, CIS Controls, ATT&CK, D3FEND, and NIST incident-response guidance.

## Hardening and exposure management

- Maintain an accurate asset, identity, service, data-flow, and dependency inventory.
- Establish secure configurations, least privilege, strong identity controls, segmentation, patching, secret management, and recoverable backups.
- Prioritize exposure using technical severity, active threat context, business criticality, internet exposure, control gaps, and remediation feasibility.
- Fix root causes and control gaps, not only observable symptoms.

## Detection and hunting

Start with a detection or hunt hypothesis. Define the behavior, telemetry sources, data quality requirements, expected signal, known benign explanations, validation method, owner, and response path.

Map observed behavior to adversary techniques and potential defensive countermeasures only when it improves communication or control selection. Test detections with safe, authorized simulation or representative evidence. Measure false positives, blind spots, latency, coverage, and operational cost.

## Incident response and forensics

Preserve evidence before changing it where practical. Record collection source, time, integrity information, handling, and limitations. Separate facts from inferences.

For a suspected incident: contain proportionately, preserve evidence, analyze scope and root cause, eradicate the condition, recover safely, monitor for recurrence, and capture lessons learned. Escalate immediately when regulated data, critical services, or possible active compromise are involved.

Do not execute suspicious material on the host. Perform non-executing triage unless a suitable controlled environment is available and the work is authorized.

## Recovery and improvement

Verify restoration through functional and security checks. Track residual risk, incomplete remediation, control owners, deadlines, and acceptance decisions. Feed lessons into architecture, secure development, detection, response procedures, and exercises.
