const fs = require('fs');
const path = require('path');

const CREDS_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.sharekhan.properties');
const TEMPLATE = `# Sharekhan API Credentials
# API docs: https://github.com/Sharekhan-API/shareconnectnodejs
SHAREKHAN_API_KEY=your_api_key_here
SHAREKHAN_CUSTOMER_ID=your_customer_id_here
SHAREKHAN_ACCESS_TOKEN=your_access_token_here
# Optional for session generation (manual refresh path)
SHAREKHAN_SECRET_KEY=your_secret_key_here
SHAREKHAN_REQUEST_TOKEN=your_request_token_here
SHAREKHAN_VERSION_ID=your_version_id_here
SHAREKHAN_VENDOR_KEY=your_vendor_key_here
# Optional: Sharekhan streaming scrip codes for indices, if the script master cannot resolve them.
SHAREKHAN_NIFTY_SCRIP_CODE=
SHAREKHAN_MIDCAP150_SCRIP_CODE=
SHAREKHAN_SMALLCAP100_SCRIP_CODE=
SHAREKHAN_BANKNIFTY_SCRIP_CODE=
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

function cleanValue(v) {
  const value = String(v || '').trim();
  return value && !value.includes('your_') ? value : '';
}

function pickCredential(creds, keys) {
  for (const key of keys) {
    const value = cleanValue(process.env[key] || creds[key]);
    if (value) return value;
  }
  return '';
}

function loadSharekhanCredentials(options = {}) {
  const requireSession = options.requireSession !== false;
  let fileCreds = {};
  if (!fs.existsSync(CREDS_FILE)) {
    try {
      fs.writeFileSync(CREDS_FILE, TEMPLATE, 'utf8');
      console.warn(`[sharekhan-credentials] Created template at ${CREDS_FILE}. Please fill in your credentials.`);
    } catch (err) {
      console.error('[sharekhan-credentials] Failed to create template:', err.message);
    }
  } else {
    try {
      const content = fs.readFileSync(CREDS_FILE, 'utf8');
      fileCreds = parseCredentialsFile(content);
    } catch (err) {
      console.error('[sharekhan-credentials] Failed to load credentials:', err.message);
      return null;
    }
  }

  try {
    const apiKey       = pickCredential(fileCreds, ['SHAREKHAN_API_KEY', 'SHAREKHAN_APP_KEY', 'SHAREKHAN_APIKEY']);
    const customerId   = pickCredential(fileCreds, ['SHAREKHAN_CUSTOMER_ID', 'SHAREKHAN_CLIENT_ID']);
    const accessToken  = pickCredential(fileCreds, ['SHAREKHAN_ACCESS_TOKEN']);
    const secretKey    = pickCredential(fileCreds, ['SHAREKHAN_SECRET_KEY', 'SHAREKHAN_API_SECRET']);
    const requestToken = pickCredential(fileCreds, ['SHAREKHAN_REQUEST_TOKEN']);
    const versionId    = pickCredential(fileCreds, ['SHAREKHAN_VERSION_ID']);
    const vendorKey    = pickCredential(fileCreds, ['SHAREKHAN_VENDOR_KEY']);
    const niftyScripCode = pickCredential(fileCreds, ['SHAREKHAN_NIFTY_SCRIP_CODE', 'SHAREKHAN_NIFTY50_SCRIP_CODE', 'NIFTY_SHAREKHAN_SCRIP_CODE']);
    const midcap150ScripCode = pickCredential(fileCreds, ['SHAREKHAN_MIDCAP150_SCRIP_CODE', 'SHAREKHAN_NIFTY_MIDCAP150_SCRIP_CODE', 'MIDCAP150_SHAREKHAN_SCRIP_CODE']);
    const smallcap100ScripCode = pickCredential(fileCreds, ['SHAREKHAN_SMALLCAP100_SCRIP_CODE', 'SHAREKHAN_NIFTY_SMALLCAP100_SCRIP_CODE', 'SMALLCAP100_SHAREKHAN_SCRIP_CODE']);
    const bankNiftyScripCode = pickCredential(fileCreds, ['SHAREKHAN_BANKNIFTY_SCRIP_CODE', 'SHAREKHAN_NIFTY_BANK_SCRIP_CODE', 'BANKNIFTY_SHAREKHAN_SCRIP_CODE']);

    if (!apiKey) {
      console.error('[sharekhan-credentials] API key is missing in environment or ' + CREDS_FILE);
      return null;
    }
    if (!customerId) {
      console.error('[sharekhan-credentials] Customer ID is missing in environment or ' + CREDS_FILE);
      if (!requireSession) return { apiKey, customerId, accessToken, secretKey, requestToken, versionId, vendorKey, niftyScripCode, midcap150ScripCode, smallcap100ScripCode, bankNiftyScripCode };
      return null;
    }
    if (requireSession && !accessToken && !(requestToken && secretKey)) {
      console.error('[sharekhan-credentials] ACCESS_TOKEN or (REQUEST_TOKEN + SECRET_KEY) must be configured in environment or ' + CREDS_FILE);
      return null;
    }

    return { apiKey, customerId, accessToken, secretKey, requestToken, versionId, vendorKey, niftyScripCode, midcap150ScripCode, smallcap100ScripCode, bankNiftyScripCode };
  } catch (err) {
    console.error('[sharekhan-credentials] Failed to load credentials:', err.message);
    return null;
  }
}

function saveSharekhanTokens({ requestToken, accessToken }) {
  try {
    const token = cleanValue(accessToken);
    if (!token || !fs.existsSync(CREDS_FILE)) return false;
    const content = fs.readFileSync(CREDS_FILE, 'utf8');
    const lines = content.split('\n');
    const upsert = (key, value) => {
      const clean = cleanValue(value);
      if (!clean) return;
      const idx = lines.findIndex(line => line.startsWith(`${key}=`));
      if (idx >= 0) lines[idx] = `${key}=${clean}`;
      else lines.push(`${key}=${clean}`);
    };
    upsert('SHAREKHAN_REQUEST_TOKEN', requestToken);
    upsert('SHAREKHAN_ACCESS_TOKEN', token);
    fs.writeFileSync(CREDS_FILE, lines.join('\n'), 'utf8');
    return true;
  } catch (err) {
    console.warn('[sharekhan-credentials] Failed to persist access token:', err.message);
    return false;
  }
}

function saveSharekhanAccessToken(accessToken) {
  return saveSharekhanTokens({ accessToken });
}

module.exports = { loadSharekhanCredentials, saveSharekhanAccessToken, saveSharekhanTokens, CREDS_FILE };
