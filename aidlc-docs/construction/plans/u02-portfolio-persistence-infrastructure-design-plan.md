# U02 Portfolio Persistence Infrastructure Design Plan

## Plan

- [x] Map U02 owner, storage, backup, health, and dispatch components to the approved local topology.
- [x] Evaluate deployment, compute, storage, messaging, networking, monitoring, and shared-resource categories.
- [x] Define environment-specific paths, encryption attestation, permissions, and lifecycle.
- [x] Define backup destination, consistency, verification, and U06 handoff.
- [x] Define deployment architecture, failure boundaries, and explicit N/A infrastructure.
- [x] Validate extension compliance and present the Infrastructure Design review gate.

## Infrastructure Decisions

### Question 1 - Deployment Environment

A) Existing local Windows workstation and Node process; no cloud database or new service (recommended)

B) Separate local database service

C) Cloud-managed database

X) Other

[Answer]: A

### Question 2 - Compute

A) Run U02 in-process with the existing Node application and one synchronous SQLite owner (recommended)

B) Dedicated worker process

C) Containerized sidecar

X) Other

[Answer]: A

### Question 3 - Storage

A) Local `portfolio-management.db` on an attested BitLocker/EFS-protected NTFS location, configurable by environment (recommended)

B) Unattested workspace file

C) Network share

X) Other

[Answer]: A

### Question 4 - Messaging

A) SQLite event outbox in the same database; no external queue in U02 (recommended)

B) Local Redis

C) Cloud queue

X) Other

[Answer]: A

### Question 5 - Networking

A) N/A: U02 opens no socket and is reachable only through in-process capabilities (recommended)

B) Local TCP database proxy

C) Remote database port

X) Other

[Answer]: A

### Question 6 - Monitoring

A) Expose bounded owner health and integrity metadata to U06; no independent monitoring agent (recommended)

B) Write standalone persistence logs and alerts

C) Add a database dashboard service

X) Other

[Answer]: A

### Question 7 - Shared Infrastructure

A) Share only the existing process and encrypted volume; retain a separate database file, backup namespace, and owner (recommended)

B) Store portfolio tables in `stock-watcher.db`

C) Attach the legacy database read-only

X) Other

[Answer]: A
