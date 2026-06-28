#!/usr/bin/env python3
"""
Sharekhan Access Token Generator
=================================
Usage:
  python sharekhan_login.py

Steps:
  1. Opens the Sharekhan login URL in your browser
  2. You log in and get redirected to a URL with ?request_token=...
  3. Paste that redirect URL here
  4. Script generates the access token and updates ~/.sharekhan.properties

Requirements:
  Node.js must be installed (uses sharekhan-api npm package for token exchange)
"""

import os
import sys
import json
import subprocess
import webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs

CREDS_FILE = Path.home() / ".sharekhan.properties"
SHAREKHAN_LOGIN_BASE = "https://api.sharekhan.com/skapi/auth/login.html"


def load_properties(path: Path) -> dict:
    """Read a .properties file (key=value, # comments)."""
    props = {}
    if not path.exists():
        return props
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, _, v = line.partition("=")
            props[k.strip()] = v.strip()
    return props


def save_property(path: Path, key: str, value: str):
    """Update or append a single key=value in the properties file."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    found = False
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            found = True
            break
    if not found:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"  ✓ Saved {key} to {path}")


def generate_access_token(script_dir: Path, api_key: str, request_token: str,
                           secret_key: str, version_id: str = "", vendor_key: str = "") -> str:
    """
    Delegate token generation to Node.js — uses the real sharekhan-api AES-256-GCM
    encryption which is too complex to replicate cleanly in Python.
    """
    node_script = f"""
const {{ SharekhanApi }} = require('./node_modules/sharekhan-api/lib');
const client = new SharekhanApi({{
  api_key: {json.dumps(api_key)},
  customer_id: 'x',
  vender_key: {json.dumps(vendor_key)} || undefined,
}});
async function run() {{
  try {{
    const fn = {json.dumps(version_id)} 
      ? client.generateSessionWithVersionID.bind(client)
      : client.generateSessionWithoutVersionID.bind(client);
    const args = {json.dumps(version_id)}
      ? [{json.dumps(request_token)}, {json.dumps(secret_key)}, {json.dumps(version_id)}]
      : [{json.dumps(request_token)}, {json.dumps(secret_key)}];
    const result = await fn(...args);
    const data = result?.data ?? result;
    const token = data?.token || data?.accessToken || data?.jwtToken || '';
    if (!token) {{
      process.stderr.write(JSON.stringify(result) + '\\n');
      process.exit(1);
    }}
    process.stdout.write(token);
  }} catch(e) {{
    process.stderr.write(e.message + '\\n');
    process.exit(1);
  }}
}}
run();
"""
    result = subprocess.run(
        ["node", "-e", node_script],
        capture_output=True, text=True, cwd=str(script_dir)
    )
    if result.returncode != 0:
        err = result.stderr.strip()
        try:
            parsed = json.loads(err)
            raise ValueError(f"Sharekhan API error: {parsed}")
        except (json.JSONDecodeError, ValueError):
            raise ValueError(err or "Node.js token generation failed")
    token = result.stdout.strip()
    if not token:
        raise ValueError("Empty token returned")
    return token


def main():
    print("=" * 60)
    print("  Sharekhan Access Token Generator")
    print("=" * 60)

    # 1. Load existing credentials
    props = load_properties(CREDS_FILE)

    api_key     = (props.get("SHAREKHAN_API_KEY") or "").strip()
    customer_id = (props.get("SHAREKHAN_CUSTOMER_ID") or props.get("SHAREKHAN_CLIENT_ID") or "").strip()
    secret_key  = (props.get("SHAREKHAN_SECRET_KEY") or props.get("SHAREKHAN_API_SECRET") or "").strip()
    version_id  = (props.get("SHAREKHAN_VERSION_ID") or "").strip()
    vendor_key  = (props.get("SHAREKHAN_VENDOR_KEY") or "").strip()
    access_token= (props.get("SHAREKHAN_ACCESS_TOKEN") or "").strip()

    # Strip placeholder values
    def is_placeholder(v):
        return not v or v.startswith("your_")

    if is_placeholder(api_key):
        api_key = input("\nEnter SHAREKHAN_API_KEY: ").strip()
    else:
        print(f"\n  API Key: {api_key[:6]}... (from {CREDS_FILE})")

    if is_placeholder(customer_id):
        customer_id = input("Enter SHAREKHAN_CUSTOMER_ID: ").strip()
    else:
        print(f"  Customer ID: {customer_id} (from {CREDS_FILE})")

    # Option A: User already has access token
    if not is_placeholder(access_token):
        print(f"\n  Existing ACCESS_TOKEN found: {access_token[:12]}...")
        choice = input("  Use existing token? [Y/n]: ").strip().lower()
        if choice != "n":
            print("\n  ✓ Using existing token. No changes needed.")
            print("  ✓ Restart the proxy server if you haven't already.\n")
            return

    # Option B: Paste token directly
    print("\n  How would you like to get the access token?")
    print("  1) Browser login (OAuth flow) — recommended")
    print("  2) Paste access token directly (if you already have it)")
    choice = input("  Enter choice [1/2]: ").strip()

    if choice == "2":
        access_token = input("  Paste your SHAREKHAN_ACCESS_TOKEN: ").strip()
        if not access_token:
            print("  ✗ No token entered. Exiting.")
            sys.exit(1)
        print(f"\n  Saving to {CREDS_FILE}...")
        save_property(CREDS_FILE, "SHAREKHAN_API_KEY",      api_key)
        save_property(CREDS_FILE, "SHAREKHAN_CUSTOMER_ID",  customer_id)
        save_property(CREDS_FILE, "SHAREKHAN_ACCESS_TOKEN", access_token)
        print("\n  ✓ Done! Restart the proxy server to apply.\n")
        return

    # Option 1: Browser OAuth flow — now ask for secret_key
    if is_placeholder(secret_key):
        secret_key = input("Enter SHAREKHAN_SECRET_KEY (needed to exchange request_token): ").strip()
    if is_placeholder(version_id):
        version_id = input("Enter SHAREKHAN_VERSION_ID (press Enter to skip): ").strip()
    if is_placeholder(vendor_key):
        vendor_key = input("Enter SHAREKHAN_VENDOR_KEY (press Enter to skip): ").strip()

    # Build login URL and open browser
    login_url = (
        f"{SHAREKHAN_LOGIN_BASE}"
        f"?api_key={api_key}"
        f"&state=stock-watcher"
        + (f"&vender_key={vendor_key}" if vendor_key else "")
    )

    print(f"\n  Opening login URL in browser:\n  {login_url}\n")
    print("  → Log in with your Sharekhan credentials")
    print("  → After login you'll be redirected to a URL like:")
    print("    https://yourapp.com/callback?request_token=XXXX&status=success")
    print("  → Copy that FULL redirect URL and paste it below.\n")
    webbrowser.open(login_url)

    redirect_url = input("Paste the full redirect URL here: ").strip()

    # Extract request_token from redirect URL
    try:
        parsed = urlparse(redirect_url)
        params = parse_qs(parsed.query)
        request_token = params.get("request_token", [None])[0]
        if not request_token:
            frag_params = parse_qs(parsed.fragment)
            request_token = frag_params.get("request_token", [None])[0]
        if not request_token:
            request_token = redirect_url.strip()
    except Exception:
        request_token = redirect_url.strip()

    if not request_token:
        print("  ✗ Could not extract request_token. Exiting.")
        sys.exit(1)

    print(f"\n  request_token: {request_token[:8]}...")

    # Generate access token
    print("  Generating access token via Node.js sharekhan-api...")
    try:
        script_dir = Path(__file__).parent
        access_token = generate_access_token(
            script_dir, api_key, request_token, secret_key, version_id, vendor_key
        )
    except Exception as e:
        print(f"\n  ✗ Failed: {e}")
        sys.exit(1)

    print(f"  access_token:  {access_token[:12]}...")

    # Save to .sharekhan.properties
    print(f"\n  Saving to {CREDS_FILE}...")
    save_property(CREDS_FILE, "SHAREKHAN_API_KEY",       api_key)
    save_property(CREDS_FILE, "SHAREKHAN_CUSTOMER_ID",   customer_id)
    save_property(CREDS_FILE, "SHAREKHAN_SECRET_KEY",    secret_key)
    save_property(CREDS_FILE, "SHAREKHAN_ACCESS_TOKEN",  access_token)
    save_property(CREDS_FILE, "SHAREKHAN_REQUEST_TOKEN", request_token)
    if version_id:
        save_property(CREDS_FILE, "SHAREKHAN_VERSION_ID", version_id)
    if vendor_key:
        save_property(CREDS_FILE, "SHAREKHAN_VENDOR_KEY", vendor_key)

    print("\n  ✓ Done! Restart the proxy server to apply the new token.")
    print("  ✓ The server will auto-refresh using request_token + secret_key when it expires.\n")


if __name__ == "__main__":
    main()
