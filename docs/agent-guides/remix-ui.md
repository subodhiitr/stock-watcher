# Remix UI

## Responsibility

The Remix application serves the dashboard shell and the portfolio workspace. It owns route mapping, rendering middleware, UI state coordination, portfolio API calls, and browser-facing presentation.

## Module map

- `my-remix-app/server.ts` starts the server and decides whether proxy routes are embedded or forwarded.
- `my-remix-app/app/router.ts` installs static-file and render middleware and maps controllers.
- `my-remix-app/app/routes.ts` defines route contracts.
- `my-remix-app/app/actions/` contains controllers; `actions/portfolio/controller.tsx` renders portfolio views.
- `my-remix-app/app/portfolio/api/` contains the client boundary.
- `my-remix-app/app/portfolio/state/` coordinates requests and refresh behavior.
- `my-remix-app/app/portfolio/components/` renders the workspace and panels.
- `my-remix-app/app/ui/` contains shared document and shell components.

## Conventions

- Keep server API calls in `app/portfolio/api/`; do not scatter fetch calls through components.
- Treat server responses and simulation runtime status as authoritative.
- Preserve route-level security headers and no-store semantics on portfolio pages.
- Keep view selection and request coordination in state modules rather than component-local duplicated effects.
- Follow the existing Remix 3 beta APIs and TypeScript configuration.

## Validation

Run `npm run typecheck:ui`, the smallest relevant `my-remix-app` test, and `npm run check:portfolio:remix` when route or rendering behavior changes.
