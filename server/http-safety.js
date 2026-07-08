'use strict';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DEFAULT_JSON_BODY_MAX_BYTES = 256 * 1024;

class JsonBodyError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'JsonBodyError';
    this.statusCode = statusCode;
  }
}

function isLocalHostname(hostname) {
  return LOCAL_HOSTNAMES.has(String(hostname || '').toLowerCase());
}

function hostnameFromHostHeader(host) {
  const raw = String(host || '').trim();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end >= 0 ? raw.slice(0, end + 1) : raw;
  }
  return raw.split(':')[0];
}

function isLocalRemoteAddress(address) {
  const value = String(address || '').toLowerCase();
  return !value
    || value === '127.0.0.1'
    || value === '::1'
    || value === '::ffff:127.0.0.1'
    || value === 'localhost';
}

function isLocalHostHeader(host) {
  const hostname = hostnameFromHostHeader(host);
  return !hostname || isLocalHostname(hostname);
}

function isAllowedOrigin(origin, { allowNull = true } = {}) {
  if (!origin) return true;
  if (origin === 'null') return allowNull;
  try {
    const parsed = new URL(origin);
    return isLocalHostname(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function applyLocalCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (origin === 'null') {
    res.setHeader('Access-Control-Allow-Origin', 'null');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Live-Trade-Confirm');
}

function rejectUnsafeNonLocalRequest(req, res) {
  if (process.env.LOCAL_API_ALLOW_REMOTE === '1') return false;
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;

  const remoteAddress = req.socket?.remoteAddress;
  const host = req.headers?.host;
  const origin = req.headers?.origin;
  if (!isLocalRemoteAddress(remoteAddress) || !isLocalHostHeader(host) || !isAllowedOrigin(origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Local API rejects non-local mutation requests' }));
    return true;
  }
  return false;
}

function readJsonBody(req, options = {}) {
  if (typeof options === 'number') options = { timeoutMs: options };
  const timeoutMs = Number(options.timeoutMs || 5000);
  const maxBytes = Number(options.maxBytes || DEFAULT_JSON_BODY_MAX_BYTES);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => finish(resolve, {}), timeoutMs);

    req.on('data', chunk => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        finish(reject, new JsonBodyError(`JSON body exceeds ${maxBytes} bytes`, 413));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        finish(resolve, body ? JSON.parse(body) : {});
      } catch (e) {
        finish(reject, new JsonBodyError('Invalid JSON', 400));
      }
    });
    req.on('error', e => finish(reject, e));
  });
}

function jsonBodyErrorStatus(error, fallback = 400) {
  return Number(error?.statusCode || fallback);
}

module.exports = {
  DEFAULT_JSON_BODY_MAX_BYTES,
  JsonBodyError,
  applyLocalCors,
  isAllowedOrigin,
  isLocalHostHeader,
  isLocalRemoteAddress,
  jsonBodyErrorStatus,
  readJsonBody,
  rejectUnsafeNonLocalRequest,
};
