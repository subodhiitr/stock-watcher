# U05 Execution and Reconciliation Functional Design Plan

## Scope

Produce documentation-only Functional Design for U05. No application code, tests, package files, persisted data, credentials, broker sessions, or trade paths may be changed or invoked. U06 NFR Requirements and every later stage remain out of scope.

## Governing Inputs

- `.aidlc-rule-details/construction/functional-design.md`
- `.aidlc-rule-details/common/content-validation.md`
- Enabled Security Baseline, Resiliency Baseline, and Property-Based Testing extension rules
- Approved requirements, personas, US-021 through US-027, application design, unit definitions, dependency map, and story map
- U01 through U04 functional-design and implementation summaries
- Current `server/portfolio/` U01/U02/U04 contracts and protected legacy Zerodha/Sharekhan boundaries

## Autonomous Decision Policy

The completion request explicitly directs ambiguity resolution without waiting for user input. Every unresolved financial-safety choice therefore uses the least-authority, fail-closed option and is recorded as an `AD-U05-*` decision in the design. No decision may enable live submission, infer a broker result, spend unsettled or unconfirmed cash, or overwrite evidence.

## Execution Checklist

- [x] Load the Functional Design procedure, common workflow rules, content-validation rules, current AI-DLC state, extension opt-in metadata, and all three enabled extension rule sets.
- [x] Confirm the documentation-only boundary, protected files and data, current U05 stage, enabled extension modes, and explicit prohibition on real orders.
- [x] Read U05 requirements, personas, US-021 through US-027, application components and methods, unit definition, dependency map, story map, and acceptance mappings.
- [x] Inspect U01 through U04 design and implementation artifacts for exact values, state versions, transaction semantics, plan hashes, order intents, timing, and safety invariants.
- [x] Inspect current `server/portfolio/` contracts and legacy Zerodha/Sharekhan clients to establish brownfield compatibility and identify adapter hazards.
- [x] Record conservative `AD-U05-*` decisions for approval, execution modes, price and plan staleness, sequencing, retries, ambiguity, reconciliation, accounting, kill switches, and recovery.
- [x] Define the deterministic approval, execution, order, fill, cancellation, reconciliation, and recovery state machines and their transition algorithms.
- [x] Define exact plan-to-order conversion, stable identity and payload hashes, intent-before-submit, sell-before-buy, execution-window, CNC-only, no-short, no-leverage, and stale-input rules.
- [x] Define paper, fake, dry-run, Zerodha, and Sharekhan port semantics while keeping all live adapters structurally disabled by default.
- [x] Define reconciliation and exact cash, holding, lot, reservation, and fill posting through the U02 synchronous transaction boundary with immutable evidence.
- [x] Create `business-logic-model.md` with failure, retry, unknown-outcome, kill-switch, restart, recovery, and misuse behavior.
- [x] Create `business-rules.md` with unique subsystem-prefixed rule IDs, deterministic failure precedence, and stable failure codes.
- [x] Create `domain-entities.md` with exact immutable entities, relationships, port contracts, compatibility notes, and canonical representations.
- [x] Trace every U05 primary story, relevant acceptance criterion, requirement, and supporting cross-unit story to explicit design sections.
- [x] Complete PBT-01 property-family analysis, state models, domain-specific generator needs, shrinking constraints, and complementary example requirements.
- [x] Evaluate all Security, Resiliency, and Property-Based Testing extension rules; resolve every applicable blocking finding or classify it N/A with rationale.
- [x] Validate Markdown structure, table shape, code fences, special characters, deterministic algorithms, unique decision and rule IDs/counts, story and requirement references, artifact cross-references, and scope.
- [x] Verify the worktree changed only U05 documentation, `aidlc-state.md`, and append-only `audit.md` entries attributable to this task.
- [x] Append the U05 Functional Design completion/approval audit entry and update `aidlc-state.md` to mark the stage complete with NFR Requirements next but unstarted.

## Planned Artifacts

- `aidlc-docs/construction/u05-execution-reconciliation/functional-design/business-logic-model.md`
- `aidlc-docs/construction/u05-execution-reconciliation/functional-design/business-rules.md`
- `aidlc-docs/construction/u05-execution-reconciliation/functional-design/domain-entities.md`

## Completion Gate

Completion requires zero unresolved blocking findings, at least six source-story mappings, exact decision and rule counts, valid internal cross-references, explicit brownfield compatibility, and proof that the design neither authorizes nor invokes real order submission.
