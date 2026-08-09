# U08 React Portfolio Workspace - Implementation Plan

## Scope

Implement the three U08 stories as a dedicated Remix workspace backed by the protected U07 API. Keep the UI isolated from the legacy dashboard and keep server authorization authoritative.

## Steps

- [x] Register `/portfolio` and portfolio-scoped overview, holdings, strategy, rebalance, performance, and operations URLs.
- [x] Add a typed API client with secure same-origin mutations and stale-request cancellation.
- [x] Add sign-in, session-expiry, unconfigured-runtime, portfolio selection, creation, empty, loading, and error states.
- [x] Add overview, holdings, strategy, rebalance, performance, and privileged operations panels.
- [x] Add explicit safety-state text, disabled-action explanations, and consequence-focused archive confirmation.
- [x] Add semantic controls, keyboard order, skip navigation, visible focus, and high-contrast styling.
- [x] Add focused route and request-coordinator tests and verify all dedicated URLs avoid legacy dashboard assets.
- [x] Run UI type checking, focused U08 tests, React quality review, and a live HTTP smoke test.

## Safety Boundaries

- UI state is scoped by the selected portfolio URL and late responses are discarded.
- Hidden or disabled controls never replace server-side authorization.
- The workspace does not import legacy dashboard markup, scripts, globals, credentials, SQL, or broker adapters.
- Live and automated modes cannot be self-enabled from portfolio creation.
