// zerodha-credentials.js
const fs = require('fs');
const path = require('path');

const CREDS_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.zerodha.properties');
const TEMPLATE = `# Zerodha Kite Connect Credentials
# Get API_KEY and API_SECRET from https://kite.zerodha.com/account/developer/applications
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
ZERODHA_ACCESS_TOKEN=your_access_token_here
# Optional but recommended for auto-renew via kiteconnectjs
ZERODHA_REFRESH_TOKEN=your_refresh_token_here
`;

function parseCredentialsFile(content) {
  const creds = {};
  content.split('\n').forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      const idx = line.indexOf('=');
      if (idx > -1) {
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        if (key) creds[key] = val;
      }
    }
  });
  return creds;
}

function loadCredentials() {
  // If file doesn't exist, create template with instructions
  if (!fs.existsSync(CREDS_FILE)) {
    try {
      fs.writeFileSync(CREDS_FILE, TEMPLATE, 'utf8');
      console.warn(`[zerodha-credentials] Created template at ${CREDS_FILE}. Please fill in your credentials.`);
    } catch (err) {
      console.error(`[zerodha-credentials] Failed to create template:`, err.message);
    }
    return null;
  }

  try {
    const content = fs.readFileSync(CREDS_FILE, 'utf8');
    const creds = parseCredentialsFile(content);

    // Validate core app credentials
    if (!creds.ZERODHA_API_KEY || creds.ZERODHA_API_KEY.includes('your_')) {
      console.error('[zerodha-credentials] API_KEY not configured in ' + CREDS_FILE);
      return null;
    }
    if (!creds.ZERODHA_API_SECRET || creds.ZERODHA_API_SECRET.includes('your_')) {
      console.error('[zerodha-credentials] API_SECRET not configured in ' + CREDS_FILE);
      return null;
    }

    const accessToken = String(creds.ZERODHA_ACCESS_TOKEN || '').trim();
    const refreshToken = String(creds.ZERODHA_REFRESH_TOKEN || '').trim();
    const hasAccessToken = !!accessToken && !accessToken.includes('your_');
    const hasRefreshToken = !!refreshToken && !refreshToken.includes('your_');
    if (!hasAccessToken && !hasRefreshToken) {
      console.error('[zerodha-credentials] ACCESS_TOKEN or REFRESH_TOKEN must be configured in ' + CREDS_FILE);
      return null;
    }
    if (!hasAccessToken && hasRefreshToken) {
      console.warn('[zerodha-credentials] ACCESS_TOKEN missing. Will attempt refresh-token bootstrap on startup.');
    }

    return {
      apiKey: creds.ZERODHA_API_KEY,
      apiSecret: creds.ZERODHA_API_SECRET,
      accessToken: hasAccessToken ? accessToken : '',
      refreshToken: hasRefreshToken ? refreshToken : ''
    };
  } catch (err) {
    console.error('[zerodha-credentials] Failed to load credentials:', err.message);
    return null;
  }
}

function saveCredentialsTokens({ requestToken, accessToken, refreshToken }) {
  try {
    if (!fs.existsSync(CREDS_FILE)) return false;
    const content = fs.readFileSync(CREDS_FILE, 'utf8');
    const lines = content.split('\n');

    const upsert = (key, value) => {
      if (!value || String(value).includes('your_')) return;
      const idx = lines.findIndex(line => line.startsWith(`${key}=`));
      if (idx >= 0) lines[idx] = `${key}=${value}`;
      else lines.push(`${key}=${value}`);
    };

    upsert('ZERODHA_REQUEST_TOKEN', requestToken);
    upsert('ZERODHA_ACCESS_TOKEN', accessToken);
    upsert('ZERODHA_REFRESH_TOKEN', refreshToken);
    fs.writeFileSync(CREDS_FILE, lines.join('\n'), 'utf8');
    return true;
  } catch (err) {
    console.warn('[zerodha-credentials] Failed to persist refreshed tokens:', err.message);
    return false;
  }
}

module.exports = { loadCredentials, saveCredentialsTokens, CREDS_FILE };
