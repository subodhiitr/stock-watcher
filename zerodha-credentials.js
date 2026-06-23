// zerodha-credentials.js
const fs = require('fs');
const path = require('path');

const CREDS_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.zerodha.properties');
const TEMPLATE = `# Zerodha Kite Connect Credentials
# Get API_KEY and API_SECRET from https://kite.zerodha.com/account/developer/applications
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
ZERODHA_ACCESS_TOKEN=your_access_token_here
`;

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
    const creds = {};
    
    content.split('\n').forEach(line => {
      if (line.trim() && !line.startsWith('#')) {
        const [key, val] = line.split('=');
        if (key && val) creds[key.trim()] = val.trim();
      }
    });

    // Validate all required fields
    if (!creds.ZERODHA_API_KEY || creds.ZERODHA_API_KEY.includes('your_')) {
      console.error('[zerodha-credentials] API_KEY not configured in ' + CREDS_FILE);
      return null;
    }
    if (!creds.ZERODHA_API_SECRET || creds.ZERODHA_API_SECRET.includes('your_')) {
      console.error('[zerodha-credentials] API_SECRET not configured in ' + CREDS_FILE);
      return null;
    }
    if (!creds.ZERODHA_ACCESS_TOKEN || creds.ZERODHA_ACCESS_TOKEN.includes('your_')) {
      console.error('[zerodha-credentials] ACCESS_TOKEN not configured in ' + CREDS_FILE);
      return null;
    }

    return {
      apiKey: creds.ZERODHA_API_KEY,
      apiSecret: creds.ZERODHA_API_SECRET,
      accessToken: creds.ZERODHA_ACCESS_TOKEN
    };
  } catch (err) {
    console.error('[zerodha-credentials] Failed to load credentials:', err.message);
    return null;
  }
}

module.exports = { loadCredentials, CREDS_FILE };
