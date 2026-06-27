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

function loadSharekhanCredentials() {
  if (!fs.existsSync(CREDS_FILE)) {
    try {
      fs.writeFileSync(CREDS_FILE, TEMPLATE, 'utf8');
      console.warn(`[sharekhan-credentials] Created template at ${CREDS_FILE}. Please fill in your credentials.`);
    } catch (err) {
      console.error('[sharekhan-credentials] Failed to create template:', err.message);
    }
    return null;
  }

  try {
    const content = fs.readFileSync(CREDS_FILE, 'utf8');
    const creds = parseCredentialsFile(content);
    const apiKey      = cleanValue(creds.SHAREKHAN_API_KEY);
    const customerId  = cleanValue(creds.SHAREKHAN_CUSTOMER_ID || creds.SHAREKHAN_CLIENT_ID);
    const accessToken = cleanValue(creds.SHAREKHAN_ACCESS_TOKEN);
    const secretKey   = cleanValue(creds.SHAREKHAN_SECRET_KEY || creds.SHAREKHAN_API_SECRET);
    const requestToken = cleanValue(creds.SHAREKHAN_REQUEST_TOKEN);
    const versionId   = cleanValue(creds.SHAREKHAN_VERSION_ID);
    const vendorKey   = cleanValue(creds.SHAREKHAN_VENDOR_KEY);

    if (!apiKey) {
      console.error('[sharekhan-credentials] API key is missing in ' + CREDS_FILE);
      return null;
    }
    if (!customerId) {
      console.error('[sharekhan-credentials] Customer ID is missing in ' + CREDS_FILE);
      return null;
    }
    if (!accessToken && !(requestToken && secretKey)) {
      console.error('[sharekhan-credentials] ACCESS_TOKEN or (REQUEST_TOKEN + SECRET_KEY) must be configured in ' + CREDS_FILE);
      return null;
    }

    return { apiKey, customerId, accessToken, secretKey, requestToken, versionId, vendorKey };
  } catch (err) {
    console.error('[sharekhan-credentials] Failed to load credentials:', err.message);
    return null;
  }
}

function saveSharekhanAccessToken(accessToken) {
  try {
    const token = cleanValue(accessToken);
    if (!token || !fs.existsSync(CREDS_FILE)) return false;
    const content = fs.readFileSync(CREDS_FILE, 'utf8');
    const lines = content.split('\n');
    const idx = lines.findIndex(line => line.startsWith('SHAREKHAN_ACCESS_TOKEN='));
    if (idx >= 0) lines[idx] = `SHAREKHAN_ACCESS_TOKEN=${token}`;
    else lines.push(`SHAREKHAN_ACCESS_TOKEN=${token}`);
    fs.writeFileSync(CREDS_FILE, lines.join('\n'), 'utf8');
    return true;
  } catch (err) {
    console.warn('[sharekhan-credentials] Failed to persist access token:', err.message);
    return false;
  }
}

module.exports = { loadSharekhanCredentials, saveSharekhanAccessToken, CREDS_FILE };
