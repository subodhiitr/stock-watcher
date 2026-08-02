const test = require('node:test');
const assert = require('node:assert/strict');

const { isSameHostOrigin, isSamePrivateLanOrigin, rejectUnsafeNonLocalRequest } = require('../server/http-safety');

function responseMock() {
  return {
    status: null,
    body: '',
    writeHead(status) { this.status = status; },
    end(body) { this.body = body || ''; },
  };
}

test('same-origin private LAN mutation is allowed', () => {
  const req = { method:'POST', socket:{ remoteAddress:'192.168.1.42' }, headers:{ host:'192.168.1.10:44100', origin:'http://192.168.1.10:44100' } };
  assert.equal(isSamePrivateLanOrigin(req.socket.remoteAddress, req.headers.host, req.headers.origin), true);
  assert.equal(rejectUnsafeNonLocalRequest(req, responseMock()), false);
});

test('same-origin Tailscale or CGNAT mutation is allowed', () => {
  const req = { method:'POST', socket:{ remoteAddress:'100.101.22.33' }, headers:{ host:'100.88.9.10:44100', origin:'http://100.88.9.10:44100' } };
  assert.equal(isSamePrivateLanOrigin(req.socket.remoteAddress, req.headers.host, req.headers.origin), true);
  assert.equal(rejectUnsafeNonLocalRequest(req, responseMock()), false);
});

test('private LAN mutation with mismatched origin is rejected', () => {
  const req = { method:'POST', socket:{ remoteAddress:'192.168.1.42' }, headers:{ host:'192.168.1.10:44100', origin:'http://192.168.1.99:44100' } };
  const res = responseMock();
  assert.equal(rejectUnsafeNonLocalRequest(req, res), true);
  assert.equal(res.status, 403);
});

test('same-origin VPN hostname mutation is allowed', () => {
  const req = { method:'POST', socket:{ remoteAddress:'100.101.22.33' }, headers:{ host:'stocks.tailnet.ts.net:44100', origin:'https://stocks.tailnet.ts.net:44100' } };
  assert.equal(isSameHostOrigin(req.headers.host, req.headers.origin), true);
  assert.equal(rejectUnsafeNonLocalRequest(req, responseMock()), false);
});

test('public remote mutation with mismatched origin remains rejected', () => {
  const req = { method:'POST', socket:{ remoteAddress:'203.0.113.5' }, headers:{ host:'stocks.example.com:44100', origin:'https://evil.example:44100' } };
  assert.equal(rejectUnsafeNonLocalRequest(req, responseMock()), true);
});

test('remote mutation without origin remains rejected', () => {
  const req = { method:'POST', socket:{ remoteAddress:'203.0.113.5' }, headers:{ host:'stocks.example.com:44100' } };
  assert.equal(rejectUnsafeNonLocalRequest(req, responseMock()), true);
});
