from __future__ import annotations

import argparse
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from kiteconnect import KiteConnect
from kiteconnect.exceptions import TokenException


DEFAULT_CREDS_FILE = Path.home() / ".zerodha.properties"
TEMPLATE = """# Zerodha Kite Connect Credentials
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
ZERODHA_REQUEST_TOKEN=your_request_token_here
ZERODHA_ACCESS_TOKEN=your_access_token_here
ZERODHA_REFRESH_TOKEN=your_refresh_token_here
"""


def read_properties(file_path: Path) -> dict[str, str]:
    props: dict[str, str] = {}
    if not file_path.exists():
        return props

    for raw_line in file_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key:
            props[key] = value
    return props


def upsert_property(lines: list[str], key: str, value: str) -> list[str]:
    prefix = f"{key}="
    for index, line in enumerate(lines):
        if line.startswith(prefix):
            lines[index] = f"{key}={value}"
            return lines
    lines.append(f"{key}={value}")
    return lines


def save_tokens(file_path: Path, request_token: str, access_token: str, refresh_token: str) -> None:
    if not file_path.exists():
        file_path.write_text(TEMPLATE, encoding="utf-8")

    lines = file_path.read_text(encoding="utf-8").splitlines()
    if request_token:
        lines = upsert_property(lines, "ZERODHA_REQUEST_TOKEN", request_token)
    lines = upsert_property(lines, "ZERODHA_ACCESS_TOKEN", access_token)
    if refresh_token:
        lines = upsert_property(lines, "ZERODHA_REFRESH_TOKEN", refresh_token)
    file_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Zerodha access and refresh tokens from a request token.")
    parser.add_argument("--creds-file", default=str(DEFAULT_CREDS_FILE), help="Path to .properties file")
    parser.add_argument("--api-key", default="", help="Override ZERODHA_API_KEY")
    parser.add_argument("--api-secret", default="", help="Override ZERODHA_API_SECRET")
    parser.add_argument("--request-token", default="", help="Override ZERODHA_REQUEST_TOKEN")
    parser.add_argument("--print-login-url", action="store_true", help="Print the Kite login URL for the configured API key")
    parser.add_argument("--no-save", action="store_true", help="Do not persist derived tokens back to the properties file")
    return parser.parse_args()


def extract_request_token(value: str) -> str:
    value = value.strip()
    if not value.lower().startswith(("http://", "https://")):
        return value

    parsed = urlparse(value)
    params = parse_qs(parsed.query)
    token = params.get("request_token", [""])[0]
    return token.strip() or value


def main() -> int:
    args = parse_args()
    creds_file = Path(args.creds_file).expanduser()
    props = read_properties(creds_file)

    api_key = args.api_key or props.get("ZERODHA_API_KEY", "")
    api_secret = args.api_secret or props.get("ZERODHA_API_SECRET", "")
    request_token = extract_request_token(args.request_token or props.get("ZERODHA_REQUEST_TOKEN", ""))

    if not api_key or api_key.startswith("your_"):
        raise SystemExit(f"ZERODHA_API_KEY is required in {creds_file} or via --api-key")
    if not api_secret or api_secret.startswith("your_"):
        raise SystemExit(f"ZERODHA_API_SECRET is required in {creds_file} or via --api-secret")
    if not request_token or request_token.startswith("your_"):
        raise SystemExit(f"ZERODHA_REQUEST_TOKEN is required in {creds_file} or via --request-token")

    kite = KiteConnect(api_key=api_key)
    if args.print_login_url:
        print(kite.login_url())
        return 0

    try:
        data = kite.generate_session(request_token, api_secret=api_secret)
    except TokenException as exc:
        if "checksum" in str(exc).lower():
            raise SystemExit(
                "Zerodha rejected the token exchange: Invalid checksum.\n"
                "Check that ZERODHA_API_KEY and ZERODHA_API_SECRET are from the same Kite Connect app, "
                "then generate a fresh request_token from that exact app login URL. "
                "Request tokens are short-lived and one-time use."
            ) from exc
        raise

    access_token = data.get("access_token", "")
    refresh_token = data.get("refresh_token", "")
    kite.set_access_token(access_token)

    print("Token exchange success.")
    print(f"ACCESS_TOKEN: {access_token}")
    if refresh_token:
        print(f"REFRESH_TOKEN: {refresh_token}")
    else:
        print("REFRESH_TOKEN is empty. Your app may not have refresh-token support enabled.")

    if not args.no_save:
        save_tokens(creds_file, request_token, access_token, refresh_token)
        print(f"Saved token(s) to {creds_file}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
