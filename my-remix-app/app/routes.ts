import { get, route } from 'remix/routes'

export const routes = route({
  assets: get('/assets/*path'),
  dashboardApp: get('/dashboard-app.js'),
  dashboardCss: get('/dashboard.css'),
  etfs: get('/etfs'),
  home: '/',
  legacyDashboard: get('/nse_midcap_dashboard.html'),
  portfolio: get('/portfolio'),
  replay: get('/replay'),
  simulationEngine: get('/simulation_engine.js'),
  stocks: get('/stocks'),
  tradeRules: get('/trade_rules.js'),
})
