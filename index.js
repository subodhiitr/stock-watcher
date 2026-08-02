const SharekhanApi = require('sharekhan-api');

// ==========================================
// 1. CONFIGURATION (Update your keys here)
// ==========================================
const API_KEY = "sBc2ZtzgogsEh7GOIxseW4kcr9BcfFlJ";          // Your Sharekhan API Key
const ACCESS_TOKEN = "eyJ0eXAiOiJnY20iLCJhbGciOiJIUzI1NiJ9.eyJqdGkiOiJyNEpvdEFRSTIvOVM2TTZFdU1PMFkxZjlpS2FJS1BzSm1nRUhZeFRsaWZCNGdTcUZyODV1VWo1Rmp2dWFrUU9RU2FuM3JIZGRaL2Z3Z3pFREd4NHpRdDRIYlJZR0thUFNrSTlyeThhYlUzd2xVcDZhMFVzdGZFMWUvOWJIeGdJMVdNT2NrZ0VudkhmUkNhU29BNGJrdXEyZk84a3E2VHFYVFAwbEZXRlZWR0NacDVHYmgrWGdNTElneS9nbWhMcW00VlYybmVERERjK3VvS009IiwiaWF0IjoxNzgzNjUxODU0LCJleHAiOjE3ODM3MDgxOTl9.TOt6GlIRqVbSrFkrpXWhA1l5hV5FTDBMJ8plj5sQs5Q";  // Your active JWT session token
const CUSTOMER_ID = "641440";    // Optional: Include if required by your account type



// ==========================================
// 1. CONFIGURATION (Update your keys here)
// ==========================================


// Helper utility to force a non-overlapping request timeline
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 2. INITIALIZE SDK WORKBENCH
// ==========================================
const skClient = new SharekhanApi({
    api_key: API_KEY,
    customer_id: CUSTOMER_ID
});

// Seed the valid active session JWT token into the instance
skClient.setAccessToken(ACCESS_TOKEN);

// ==========================================
// 3. RUNNER & SEQUENTIAL THROTTLING LOOP
// ==========================================
async function main() {
    console.log("Initializing Sharekhan SDK Data Download Sequence...\n");

    // Precise asset token map identifiers
    const scripList = [
        { exchange: "NC", code: "22", name: "NIFTY 50" },
        { exchange: "NC", code: "11111", name: "RELIANCE" },
        { exchange: "NC", code: "11536", name: "TCS" }
    ];

    const INTERVAL_TIME = "daily"; // Options: "daily", "1minute", "5minute", etc.
    const COOLDOWN_MS = 1500;       // Safe 1.5-second buffer to guarantee 429 protection

    for (let i = 0; i < scripList.length; i++) {
        const target = scripList[i];
        console.log(`[${i + 1}/${scripList.length}] Pulling ${target.name} (Code: ${target.code}) via SDK...`);

        try {
            // Using the precise native method from the shareconnectnodejs source code
            const response = await skClient.getHistoricalIntervalData(
                target.exchange, 
                target.code, 
                INTERVAL_TIME
            );

            // Handle SDK custom error objects vs structured payloads
            if (response && response.status === 429) {
                console.warn(`⚠️ Rate limit triggered for ${target.name}. Backing off 5 seconds...`);
                await sleep(5000);
                i--; // Decrement index loop counter to retry this precise item safely
                continue;
            }

            console.log(`✅ Success! Data payload for ${target.name}:`);
            console.dir(response, { depth: null, colors: true });

        } catch (error) {
            console.error(`❌ System compilation error on tracking asset ${target.name}:`, error.message);
        }

        // Apply spacing pause if there are subsequent records in the queue
        if (i < scripList.length - 1) {
            console.log(`Pausing data connection pipelines for ${COOLDOWN_MS}ms...\n`);
            await sleep(COOLDOWN_MS);
        }
    }

    console.log("\nData pipeline sync finished successfully.");
}

main();
