async function handleBrokerRoute(req, res, pathname, searchParams, deps) {
  if (pathname === '/broker-mode') {
    if (req.method === 'GET') {
      const sharekhanTicker = deps.getSharekhanTicker();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        mode: deps.getBrokerMode(),
        sharekhanTickerConnected: sharekhanTicker?._connected ?? false,
        sharekhanTickerSymbols: sharekhanTicker ? sharekhanTicker._subscribedCodes.size : 0,
        sharekhanTickerIndexSymbols: deps.getSharekhanIndexCodeMap().size,
        marketIndexSource: deps.getSimulationMarketCache().indices?.nifty50?.source || null,
      }));
      return true;
    }
    if (req.method === 'POST') {
      try {
        const payload = await deps.readJsonBody(req);
        const newMode = String(payload.mode || '').toLowerCase();
        if (!deps.validBrokerModes.has(newMode)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid mode. Valid modes: zerodha_dry_run, zerodha_live, sharekhan_live' }));
          return true;
        }
        if (newMode !== 'zerodha_dry_run' && !deps.hasLiveTradeConfirmation(req, payload)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Live broker mode requires confirmation token LIVE' }));
          return true;
        }
        deps.setBrokerMode(newMode);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, mode: deps.getBrokerMode() }));
        return true;
      } catch (e) {
        res.writeHead(deps.jsonBodyErrorStatus(e), { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
        return true;
      }
    }
    return false;
  }

  if (pathname === '/broker-status') {
    if (req.method === 'GET') {
      const zerodhaCredentials = deps.getZerodhaCredentials();
      const sharekhanCredentials = deps.getSharekhanCredentials();
      const kiteClientLive = deps.getKiteClientLive();
      const kiteClientDry = deps.getKiteClientDry();
      const sharekhanClientLive = deps.getSharekhanClientLive();
      const status = {
        mode: deps.getBrokerMode(),
        activeLiveBroker: deps.getActiveLiveBrokerKey(),
        zerodha: {
          credentialsLoaded: !!zerodhaCredentials,
          clientsInitialized: !!kiteClientLive && !!kiteClientDry,
          autoRenewConfigured: !!zerodhaCredentials?.refreshToken,
          lastTokenRefreshAt: kiteClientLive?.lastTokenRefreshAt || null,
          pollerRunning: deps.getZerodhaConfirmationPoller() !== null,
          failureCount: deps.getZerodhaLiveFailureCount(),
          isDisabled: deps.getZerodhaLiveFailureCount() >= 3,
        },
        sharekhan: {
          credentialsLoaded: !!sharekhanCredentials,
          clientsInitialized: !!sharekhanClientLive,
          autoRenewConfigured: !!sharekhanCredentials?.requestToken && !!sharekhanCredentials?.secretKey,
          lastTokenRefreshAt: sharekhanClientLive?.lastTokenRefreshAt || null,
          pollerRunning: deps.getSharekhanConfirmationPoller() !== null,
          failureCount: deps.getSharekhanLiveFailureCount(),
          isDisabled: deps.getSharekhanLiveFailureCount() >= 3,
        },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...status }));
      return true;
    }
    return false;
  }

  if (pathname === '/broker/login' || pathname === '/borker/login') {
    const { broker } = deps.readBrokerAuthParams(searchParams);
    if (req.method !== 'GET') {
      deps.sendBrokerAuthHtml(res, 405, { ok:false, broker, title:'Method not allowed', message:'Use GET for broker login.' });
      return true;
    }
    if (!broker) {
      deps.sendBrokerAuthHtml(res, 400, { ok:false, broker:'', title:'Broker login failed', message:'Use name=sharekhan or name=zerodha.' });
      return true;
    }
    try {
      const loginUrl = deps.buildBrokerLoginUrl(req, broker);
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${deps.htmlEscape(broker)} login</title><style>
        body{margin:0;background:#0c1114;color:#f4f7f8;font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh}
        main{width:min(420px,calc(100vw - 28px));border:1px solid #2d3941;border-radius:12px;background:#151c21;padding:22px;box-shadow:0 18px 50px rgba(0,0,0,.35)}
        h1{font-size:18px;margin:0 0 8px}.msg{color:#94a2aa;line-height:1.45}a{color:#38bdf8}
      </style></head><body><main><h1>${deps.htmlEscape(broker)} login</h1><div class="msg">Opening secure broker login...<br><a href="${deps.htmlEscape(loginUrl)}">Continue manually</a></div></main><script>
        window.location.replace(${JSON.stringify(loginUrl)});
      </script></body></html>`);
      return true;
    } catch (e) {
      deps.sendBrokerAuthHtml(res, 500, { ok:false, broker, title:'Broker login failed', message:e.message || 'Could not build broker login URL.' });
      return true;
    }
  }

  const brokerRefreshMatch = pathname.match(/^\/b[ro]+ker\/refresh(?:\/([^/]+))?$/i);
  if (brokerRefreshMatch) {
    const wantsJson = /\bapplication\/json\b/i.test(req.headers.accept || '');
    const fail = (statusCode, broker, message) => {
      if (wantsJson) {
        res.writeHead(statusCode, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
        res.end(JSON.stringify({ ok:false, broker, error:message }));
      } else {
        deps.sendBrokerAuthHtml(res, statusCode, { ok:false, broker, title:'Broker login failed', message });
      }
    };
    if (req.method !== 'GET') {
      fail(405, '', 'Use GET for broker refresh redirects.');
      return true;
    }
    const brokerFromPath = deps.brokerNameFromParam(brokerRefreshMatch[1] || '');
    const { broker: brokerFromQuery, requestToken } = deps.readBrokerAuthParams(searchParams);
    const broker = brokerFromPath || brokerFromQuery;
    if (!broker) {
      fail(400, '', 'Broker name missing. Use /broker/refresh/sharekhan or /broker/refresh/zerodha.');
      return true;
    }
    if (!requestToken) {
      fail(400, broker, 'Broker redirect did not include request_token.');
      return true;
    }
    try {
      if (broker === 'sharekhan') await deps.exchangeSharekhanRequestToken(requestToken);
      else await deps.exchangeZerodhaRequestToken(requestToken);
      if (wantsJson) {
        res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
        res.end(JSON.stringify({ ok:true, broker, refreshed:true }));
      } else {
        deps.sendBrokerAuthHtml(res, 200, { ok:true, broker, title:'Broker login complete', message:`${broker} access token was updated.` });
      }
      return true;
    } catch (e) {
      fail(500, broker, e.message || 'Could not exchange request token.');
      return true;
    }
  }

  if (pathname === '/broker-refresh-token') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return true;
    }
    try {
      const payload = await deps.readJsonBody(req).catch(() => ({}));
      const broker = String(payload.broker || deps.getActiveLiveBrokerKey() || 'zerodha').toLowerCase();
      if (broker === 'sharekhan') return await handleSharekhanRefresh(req, res, deps);
      return await handleZerodhaRefresh(req, res, deps);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return true;
    }
  }

  if (pathname === '/portfolio/day-pnl') {
    if (req.method === 'POST') {
      try {
        const dayPnl = deps.isDbReady() ? deps.rebuildDayPnl() : {};
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ ok: true, rebuilt: true, dayPnl }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return true;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return true;
    }
    try {
      const requestedLimit = Number.parseInt(searchParams.get('limit') || '10', 10);
      const limit = Math.max(1, Math.min(100, requestedLimit || 10));
      const dayPnl = deps.isDbReady() ? deps.getDayPnl(limit) : {};
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ ok: true, limit, dayPnl }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return true;
  }

  if (pathname === '/sharekhan-portfolio') {
    return handleSharekhanPortfolio(req, res, deps);
  }

  if (pathname === '/zerodha-portfolio') {
    return handleZerodhaPortfolio(req, res, deps);
  }

  return false;
}

async function handleSharekhanRefresh(req, res, deps) {
  let sharekhanCredentials = deps.getSharekhanCredentials();
  let sharekhanClientLive = deps.getSharekhanClientLive();
  if (!sharekhanCredentials || !sharekhanClientLive) {
    await deps.ensureSharekhanInitialized({ force: true });
    sharekhanCredentials = deps.getSharekhanCredentials();
    sharekhanClientLive = deps.getSharekhanClientLive();
  }
  if (!sharekhanCredentials || !sharekhanClientLive) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Sharekhan integration is not initialized', hint: 'Credentials were reloaded but Sharekhan could not initialize. Check ~/.sharekhan.properties tokens.' }));
    return true;
  }
  if (!sharekhanCredentials.requestToken || !sharekhanCredentials.secretKey) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Request token and secret key are not configured', hint: 'Set SHAREKHAN_REQUEST_TOKEN and SHAREKHAN_SECRET_KEY in sharekhan credentials file and restart proxy' }));
    return true;
  }
  const refreshed = await sharekhanClientLive.refreshAccessToken();
  if (!refreshed) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, renewed: false, mode: deps.getBrokerMode(), broker: 'sharekhan', autoRenewConfigured: !!sharekhanCredentials.requestToken && !!sharekhanCredentials.secretKey, lastTokenRefreshAt: sharekhanClientLive.lastTokenRefreshAt || null }));
    return true;
  }
  if (sharekhanClientLive.accessToken) deps.setSharekhanAccessToken(sharekhanClientLive.accessToken);
  deps.saveSharekhanAccessToken(sharekhanClientLive.accessToken);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, renewed: true, mode: deps.getBrokerMode(), broker: 'sharekhan', autoRenewConfigured: !!sharekhanCredentials.requestToken && !!sharekhanCredentials.secretKey, lastTokenRefreshAt: sharekhanClientLive.lastTokenRefreshAt || null }));
  return true;
}

async function handleZerodhaRefresh(req, res, deps) {
  let zerodhaCredentials = deps.getZerodhaCredentials();
  let kiteClientLive = deps.getKiteClientLive();
  let kiteClientDry = deps.getKiteClientDry();
  if (!zerodhaCredentials || !kiteClientLive || !kiteClientDry) {
    await deps.ensureZerodhaInitialized({ force: true });
    zerodhaCredentials = deps.getZerodhaCredentials();
    kiteClientLive = deps.getKiteClientLive();
    kiteClientDry = deps.getKiteClientDry();
  }
  if (!zerodhaCredentials || !kiteClientLive || !kiteClientDry) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Zerodha integration is not initialized', hint: 'Credentials were reloaded but Zerodha could not initialize. Check ~/.zerodha.properties tokens.' }));
    return true;
  }
  if (!zerodhaCredentials.refreshToken) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Refresh token is not configured', hint: 'Set ZERODHA_REFRESH_TOKEN in zerodha credentials file and restart proxy' }));
    return true;
  }
  const refreshed = await kiteClientLive.refreshAccessToken();
  if (!refreshed) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, renewed: false, mode: deps.getBrokerMode(), broker: 'zerodha', autoRenewConfigured: !!zerodhaCredentials.refreshToken, lastTokenRefreshAt: kiteClientLive.lastTokenRefreshAt || null }));
    return true;
  }
  kiteClientDry.setTokens({ accessToken: kiteClientLive.accessToken, refreshToken: kiteClientLive.refreshToken });
  deps.updateZerodhaTokens({ accessToken:kiteClientLive.accessToken, refreshToken:kiteClientLive.refreshToken });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, renewed: true, mode: deps.getBrokerMode(), broker: 'zerodha', autoRenewConfigured: !!zerodhaCredentials.refreshToken, lastTokenRefreshAt: kiteClientLive.lastTokenRefreshAt || null }));
  return true;
}

async function handleSharekhanPortfolio(req, res, deps) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed. Use GET.' }));
    return true;
  }
  try {
    let sharekhanCredentials = deps.getSharekhanCredentials();
    let sharekhanClientLive = deps.getSharekhanClientLive();
    if (!sharekhanCredentials || !sharekhanClientLive) {
      await deps.ensureSharekhanInitialized({ force: true });
      sharekhanCredentials = deps.getSharekhanCredentials();
      sharekhanClientLive = deps.getSharekhanClientLive();
    }
    if (!sharekhanCredentials || !sharekhanClientLive) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Sharekhan integration is not initialized', hint: 'Credentials were reloaded but Sharekhan could not initialize. Check ~/.sharekhan.properties tokens.' }));
      return true;
    }
    const portfolio = await deps.withSharekhanCredentialReload(() => sharekhanClientLive.getPortfolioState());
    if (Array.isArray(portfolio?.holdings?.list)) {
      let totalMarketValue = 0;
      let totalPnl = 0;
      const storedPrices = deps.buildStoredAppPriceMap(portfolio.holdings.list.map(h => h.symbol));
      for (const h of portfolio.holdings.list) {
        const storedPrice = storedPrices.get(String(h.symbol || '').trim().toUpperCase());
        if (storedPrice?.price) {
          h.ltp = Number(storedPrice.price);
          h.closePrice = Number(storedPrice.prevClose || h.closePrice || 0);
          h.ltpSource = storedPrice.source;
          const prevClose = h.closePrice || h.ltp;
          h.dayChangePct = prevClose ? +((h.ltp - prevClose) / prevClose * 100).toFixed(2) : 0;
          h.marketValue = +(h.ltp * h.qty).toFixed(2);
          h.pnl = +(h.marketValue - h.investedValue).toFixed(2);
        }
        totalMarketValue += h.marketValue || 0;
        totalPnl += h.pnl || 0;
      }
      portfolio.holdings.marketValue = +totalMarketValue.toFixed(2);
      portfolio.positions.totalPnl = +totalPnl.toFixed(2);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mode: deps.getBrokerMode(), broker: 'sharekhan', portfolio }));
  } catch (e) {
    const isAuth = deps.isSharekhanAuthReloadError(e);
    res.writeHead(isAuth ? 401 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message, hint: isAuth ? 'Token expired. Update Sharekhan credentials, then retry; the server will reload them automatically.' : undefined }));
  }
  return true;
}

async function handleZerodhaPortfolio(req, res, deps) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed. Use GET.' }));
    return true;
  }
  try {
    let zerodhaCredentials = deps.getZerodhaCredentials();
    let kiteClientLive = deps.getKiteClientLive();
    if (!zerodhaCredentials || !kiteClientLive) {
      await deps.ensureZerodhaInitialized({ force: true });
      zerodhaCredentials = deps.getZerodhaCredentials();
      kiteClientLive = deps.getKiteClientLive();
    }
    if (!zerodhaCredentials || !kiteClientLive) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Zerodha integration is not initialized', hint: 'Credentials were reloaded but Zerodha could not initialize. Check ~/.zerodha.properties tokens.' }));
      return true;
    }
    const portfolio = await kiteClientLive.getPortfolioState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mode: deps.getBrokerMode(), portfolio }));
  } catch (e) {
    const isAuth = /AUTH_FAILED_REFRESH_NEEDED|token|permission/i.test(String(e?.message || ''));
    res.writeHead(isAuth ? 401 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message, hint: isAuth ? 'Token expired. Use Refresh token now in Settings.' : undefined }));
  }
  return true;
}

module.exports = {
  handleBrokerRoute,
};
