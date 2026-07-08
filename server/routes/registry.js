'use strict';

async function dispatchRoute(handlers, req, res, pathname, searchParams) {
  for (const handler of handlers) {
    if (await handler(req, res, pathname, searchParams)) return true;
  }
  return false;
}

module.exports = {
  dispatchRoute,
};
