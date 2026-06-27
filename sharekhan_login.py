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
  pip install requests
"""

import os
import re
import sys
import hmac
import base64
import hashlib
import webbrowser
import configparser
from pathlib import Path
from urllib.parse import urlparse, parse_qs

try:
    import requests
except ImportError:
    print("Install requests first: pip install requests")
    sys.exit(1)

CREDS_FILE = Path.home() / ".sharekhan.properties"
SHAREKHAN_LOGIN_BASE = "https://api.sharekhan.com/skapi/auth/login.html"
SHAREKHAN_TOKEN_URL  = "https://api.sharekhan.com/skapi/services/access/token"


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


def aes_base64(token: str, secret_key: str) -> str:
    """
    Sharekhan token encryption (without version_id):
    HMAC-SHA256(secret_key, request_token) → base64
    """
    sig = hmac.new(secret_key.encode(), token.encode(), hashlib.sha256).digest()
    return base64.b64encode(sig).decode()


def aes_base64url(token: str, secret_key: str) -> str:
    """
    Sharekhan token encryption (with version_id):
    HMAC-SHA256(secret_key, request_token) → base64url (no padding)
    """
    sig = hmac.new(secret_key.encode(), token.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig).rstrip(b"=").decode()


def generate_access_token(api_key: str, request_token: str, secret_key: str,
                           version_id: str = "", vendor_key: str = "") -> str:
    """Call Sharekhan API to exchange request_token → access_token."""
    if version_id:
        enc = aes_base64url(request_token, secret_key)
        body = {"apiKey": api_key, "requestToken": enc, "versionId": version_id}
    else:
        enc = aes_base64(request_token, secret_key)
        body = {"apiKey": api_key, "requestToken": enc}

    headers = {"Content-Type": "application/json"}
    if vendor_key:
        headers["vender-key"] = vendor_key

    resp = requests.post(SHAREKHAN_TOKEN_URL, json=body, headers=headers, timeout=15)
    data = resp.json()

    # Try common response shapes
    token = (
        data.get("data", {}).get("token")
        or data.get("token")
        or data.get("accessToken")
        or data.get("jwtToken")
        or ""
    )
    if not token:
        print(f"\n  ✗ Server response: {data}")
        raise ValueError("No access token in server response")
    return token


def main():
    print("=" * 60)
    print("  Sharekhan Access Token Generator")
    print("=" * 60)

    # 1. Load existing credentials
    props = load_properties(CREDS_FILE)

    api_key    = props.get("SHAREKHAN_API_KEY", "").strip()
    customer_id= props.get("SHAREKHAN_CUSTOMER_ID", "").strip()
    secret_key = props.get("SHAREKHAN_SECRET_KEY", "").strip()
    version_id = props.get("SHAREKHAN_VERSION_ID", "").strip()
    vendor_key = props.get("SHAREKHAN_VENDOR_KEY", "").strip()

    # 2. Prompt for any missing required fields
    if not api_key or api_key.startswith("your_"):
        api_key = input("\nEnter SHAREKHAN_API_KEY: ").strip()
    if not secret_key or secret_key.startswith("your_"):
        secret_key = input("Enter SHAREKHAN_SECRET_KEY: ").strip()
    if not customer_id or customer_id.startswith("your_"):
        customer_id = input("Enter SHAREKHAN_CUSTOMER_ID: ").strip()
    if not version_id or version_id.startswith("your_"):
        version_id = input("Enter SHAREKHAN_VERSION_ID (press Enter to skip): ").strip()
    if not vendor_key or vendor_key.startswith("your_"):
        vendor_key = input("Enter SHAREKHAN_VENDOR_KEY (press Enter to skip): ").strip()

    # 3. Build login URL and open browser
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

    # 4. Extract request_token from redirect URL
    try:
        parsed = urlparse(redirect_url)
        params = parse_qs(parsed.query)
        request_token = params.get("request_token", [None])[0]
        if not request_token:
            # Try fragment
            frag_params = parse_qs(parsed.fragment)
            request_token = frag_params.get("request_token", [None])[0]
        if not request_token:
            # Maybe they pasted just the token
            request_token = redirect_url.strip()
    except Exception:
        request_token = redirect_url.strip()

    if not request_token:
        print("  ✗ Could not extract request_token. Exiting.")
        sys.exit(1)

    print(f"\n  request_token: {request_token[:8]}...")

    # 5. Generate access token
    print("  Generating access token...")
    try:
        access_token = generate_access_token(
            api_key, request_token, secret_key, version_id, vendor_key
        )
    except Exception as e:
        print(f"\n  ✗ Failed: {e}")
        sys.exit(1)

    print(f"  access_token:  {access_token[:12]}...")

    # 6. Save to .sharekhan.properties
    print(f"\n  Saving to {CREDS_FILE}...")
    save_property(CREDS_FILE, "SHAREKHAN_API_KEY",      api_key)
    save_property(CREDS_FILE, "SHAREKHAN_CUSTOMER_ID",  customer_id)
    save_property(CREDS_FILE, "SHAREKHAN_SECRET_KEY",   secret_key)
    save_property(CREDS_FILE, "SHAREKHAN_ACCESS_TOKEN", access_token)
    save_property(CREDS_FILE, "SHAREKHAN_REQUEST_TOKEN", request_token)
    if version_id:
        save_property(CREDS_FILE, "SHAREKHAN_VERSION_ID", version_id)
    if vendor_key:
        save_property(CREDS_FILE, "SHAREKHAN_VENDOR_KEY", vendor_key)

    print("\n  ✓ Done! Restart the proxy server to apply the new token.")
    print("  ✓ The server will auto-refresh the token using request_token + secret_key when it expires.\n")


if __name__ == "__main__":
    main()
