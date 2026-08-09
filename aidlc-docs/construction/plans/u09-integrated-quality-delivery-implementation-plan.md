# U09 Integrated Quality and Delivery - Implementation Plan

## Scope

Compose the U01-U08 verification evidence into one blocking portfolio delivery gate. Add only integrated harnesses, capacity/restore evidence, supply-chain checks, and CI wiring; do not duplicate domain logic or expose a real broker path.

## Steps

- [x] Add an end-to-end protected API acceptance test for the seeded paper portfolio, all three horizon presets, isolated creation, idempotency, scoped reads, archive, and logout invalidation.
- [x] Add a real temporary-SQLite backup/restore drill covering schema version, exact cash/state, strategy seeds, audit streams, and source preservation.
- [x] Compose every portfolio property, model, example, architecture, failure-injection, persistence, API, and operations test into a Windows-safe all-unit command.
- [x] Add a 39-story executable-evidence manifest that fails on a missing story owner or missing evidence file.
- [x] Add a capacity benchmark for 100 portfolios, 1,000 instruments, ten years of daily observations, p95 reads, portfolio jobs, and event-loop yielding.
- [x] Reuse the U05 250-order, 10,000-fill, 1,000-holding, and 100-portfolio execution benchmark as the broker-limit safety gate.
- [x] Add a delivery-safety test proving lockfiles, pinned CI actions, blocking commands, and no real-broker validation imports.
- [x] Add clean Remix Doctor/type/declaration checks as the build gate.
- [x] Add deterministic CycloneDX SBOM generation for root and Remix lockfiles.
- [x] Add a least-privilege, pinned GitHub Actions workflow with locked installs, the blocking U09 gate, critical production dependency audits, and SBOM generation.
- [x] Run the local U09 gate and broader repository compatibility suite; keep deployment blocked for any unresolved gate.

## Safety Boundaries

- U09 uses temporary databases, fake clocks, paper/dry-run/scripted brokers, deterministic fixtures, and local loopback HTTP only.
- No U09 command starts `ticker_proxy.js`, loads broker credentials, enables live mode, or calls a real broker/provider.
- Generated SBOMs and temporary databases are build artifacts and are not committed.
- A failed audit, compatibility, capacity, restore, type, build, or test gate blocks release approval.
