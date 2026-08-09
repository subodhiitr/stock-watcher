# Resiliency Clarification Questions

The resiliency baseline is enabled. These decisions are mandatory before requirements can be finalized.

## Question 1
What Recovery Time Objective, Recovery Point Objective, and disaster-recovery strategy should apply?

A) RTO and RPO measured in hours, using encrypted backup and restore (recommended for the local workstation deployment)

B) RTO and RPO measured in tens of minutes, using a pilot-light deployment

C) RTO and RPO measured in minutes, using warm standby

D) Near-real-time recovery using multi-site active/active deployment

E) Single-region deployment is acceptable with no cross-region disaster recovery

X) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 2
How should production changes be governed?

A) Use an existing organizational change-management process and identify it after the `[Answer]:` tag

B) Define a lightweight process requiring a change record, approval, test evidence, and rollback note (recommended)

C) Exempt this personal local tool from formal change management and document the exemption

X) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 3
What CI/CD tooling should be used?

A) Use an existing pipeline and identify the tool after the `[Answer]:` tag

B) Add a GitHub Actions pipeline for type checking, tests, property-based tests, security checks, and build verification (recommended)

X) Other (please describe after [Answer]: tag below)

[Answer]: B

## Question 4
How should a failed deployment be rolled back?

A) Redeploy the previous version-pinned artifact

B) Swap back to a previous blue/green environment

C) Automatically roll back a canary when health or metrics regress

D) Require database-aware rollback with explicit forward and reversal migration design (recommended because portfolio state is persistent)

E) Use an existing organizational rollback procedure and identify it after the `[Answer]:` tag

X) Other (please describe after [Answer]: tag below)

[Answer]: D

## Question 5
What deployment style is acceptable?

A) Direct or in-place deployment for the local workstation, with backup, validation, and rollback gates (recommended)

B) Rolling deployment

C) Blue/green deployment

D) Canary deployment

X) Other (please describe after [Answer]: tag below)

[Answer]: A

## Question 6
What regional topology is required?

A) Single-region, multi-zone deployment

B) Multi-region active/passive deployment

C) Multi-region active/active deployment

D) Local workstation deployment with no cloud-region topology; use encrypted backup and restore for recovery (recommended)

X) Other (please describe after [Answer]: tag below)

[Answer]: D

## Question 7
How should production incidents be handled?

A) Use an existing incident-response process and identify it after the `[Answer]:` tag

B) Define a lightweight incident-response process with severity, containment, recovery, audit, and correction-of-errors review (recommended)

X) Other (please describe after [Answer]: tag below)

[Answer]: B
