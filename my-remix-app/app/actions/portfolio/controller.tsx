import { createController } from 'remix/router'
import type { RemixNode } from 'remix/ui'

import { PortfolioWorkspace } from '../../portfolio/components/workspace.tsx'
import type { WorkspaceView } from '../../portfolio/types/views.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/document.tsx'

function securityHeaders(): HeadersInit {
  return {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...(process.env.NODE_ENV === 'production'
      ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' }
      : {}),
  }
}

function page(
  render: (node: RemixNode, init?: ResponseInit) => Response,
  initialView: WorkspaceView,
  initialPortfolioId?: string,
) {
  return render(
    <Document
      title="Portfolio Workspace — Stock Watcher"
      head={<meta name="description" content="Isolated portfolio management and operations workspace" />}
    >
      <PortfolioWorkspace
        initialView={initialView}
        {...(initialPortfolioId === undefined ? {} : { initialPortfolioId })}
      />
    </Document>,
    { headers: securityHeaders() },
  )
}

export default createController(routes.portfolio, {
  actions: {
    index(context) { return page(context.render, 'overview') },
    overview(context) { return page(context.render, 'overview', context.params.portfolioId) },
    holdings(context) { return page(context.render, 'holdings', context.params.portfolioId) },
    strategy(context) { return page(context.render, 'strategy', context.params.portfolioId) },
    rebalance(context) { return page(context.render, 'rebalance', context.params.portfolioId) },
    execution(context) { return page(context.render, 'execution', context.params.portfolioId) },
    performance(context) { return page(context.render, 'performance', context.params.portfolioId) },
    operations(context) { return page(context.render, 'operations', context.params.portfolioId) },
  },
})
