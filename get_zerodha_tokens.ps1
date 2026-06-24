param(
  [string]$ApiKey,
  [string]$ApiSecret,
  [string]$RedirectUrl,
  [string]$RequestToken,
  [string]$RefreshToken,
  [string]$CredsFile = "$env:USERPROFILE\.zerodha.properties",
  [switch]$OpenLogin,
  [switch]$SaveToCreds
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-PropertiesFile([string]$filePath) {
  $props = @{}
  if (-not (Test-Path $filePath)) {
    return $props
  }

  foreach ($line in Get-Content -Path $filePath -Encoding UTF8) {
    $trimmed = [string]$line
    if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
    $trimmed = $trimmed.Trim()
    if ($trimmed.StartsWith('#')) { continue }

    $idx = $trimmed.IndexOf('=')
    if ($idx -lt 1) { continue }

    $key = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim()
    if (-not [string]::IsNullOrWhiteSpace($key)) {
      $props[$key] = $value
    }
  }

  return $props
}

function Get-RequestTokenFromUrl([string]$url) {
  try {
    $uri = [Uri]$url
    $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
    return [string]$query['request_token']
  } catch {
    return ''
  }
}

function Get-Sha256Hex([string]$text) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $hash = $sha.ComputeHash($bytes)
    return -join ($hash | ForEach-Object { $_.ToString('x2') })
  } finally {
    $sha.Dispose()
  }
}

function Upsert-Property([string[]]$lines, [string]$key, [string]$value) {
  $prefix = "$key="
  $idx = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].StartsWith($prefix)) {
      $idx = $i
      break
    }
  }
  if ($idx -ge 0) {
    $lines[$idx] = "$key=$value"
  } else {
    $lines += "$key=$value"
  }
  return ,$lines
}

function Save-TokensToCreds([string]$filePath, [string]$requestToken, [string]$accessToken, [string]$refreshToken) {
  if (-not (Test-Path $filePath)) {
    $template = @(
      '# Zerodha Kite Connect Credentials',
      'ZERODHA_API_KEY=your_api_key_here',
      'ZERODHA_API_SECRET=your_api_secret_here',
      '# Optional: full redirect URL after login',
      'ZERODHA_REDIRECT_URL=',
      '# One-time login token used to derive ACCESS_TOKEN and REFRESH_TOKEN',
      'ZERODHA_REQUEST_TOKEN=your_request_token_here',
      'ZERODHA_ACCESS_TOKEN=your_access_token_here',
      'ZERODHA_REFRESH_TOKEN=your_refresh_token_here'
    )
    Set-Content -Path $filePath -Value $template -Encoding UTF8
  }

  $lines = @(Get-Content -Path $filePath -Encoding UTF8)
  if (-not [string]::IsNullOrWhiteSpace($requestToken)) {
    $lines = Upsert-Property -lines $lines -key 'ZERODHA_REQUEST_TOKEN' -value $requestToken
  }
  $lines = Upsert-Property -lines $lines -key 'ZERODHA_ACCESS_TOKEN' -value $accessToken
  if (-not [string]::IsNullOrWhiteSpace($refreshToken)) {
    $lines = Upsert-Property -lines $lines -key 'ZERODHA_REFRESH_TOKEN' -value $refreshToken
  }
  Set-Content -Path $filePath -Value $lines -Encoding UTF8
}

Write-Host '=== Zerodha Token Helper ===' -ForegroundColor Cyan

$props = Read-PropertiesFile -filePath $CredsFile

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
  $ApiKey = [string]$props['ZERODHA_API_KEY']
}
if ([string]::IsNullOrWhiteSpace($ApiSecret)) {
  $ApiSecret = [string]$props['ZERODHA_API_SECRET']
}
if ([string]::IsNullOrWhiteSpace($RedirectUrl)) {
  $RedirectUrl = [string]$props['ZERODHA_REDIRECT_URL']
}
if ([string]::IsNullOrWhiteSpace($RequestToken)) {
  $RequestToken = [string]$props['ZERODHA_REQUEST_TOKEN']
}
if ([string]::IsNullOrWhiteSpace($RefreshToken)) {
  $RefreshToken = [string]$props['ZERODHA_REFRESH_TOKEN']
}
if (-not $OpenLogin.IsPresent) {
  $openLoginSetting = [string]$props['ZERODHA_OPEN_LOGIN']
  if ($openLoginSetting -match '^(1|true|yes|y)$') {
    $OpenLogin = $true
  }
}
if (-not $SaveToCreds.IsPresent) {
  $saveSetting = [string]$props['ZERODHA_SAVE_TOKENS']
  if ($saveSetting -match '^(1|true|yes|y)$') {
    $SaveToCreds = $true
  }
}

if ([string]::IsNullOrWhiteSpace($ApiKey) -or [string]::IsNullOrWhiteSpace($ApiSecret)) {
  throw "API Key and API Secret are required. Set ZERODHA_API_KEY and ZERODHA_API_SECRET in $CredsFile or pass -ApiKey/-ApiSecret."
}

$loginUrl = "https://kite.trade/connect/login?v=3&api_key=$ApiKey"
Write-Host "Login URL: $loginUrl" -ForegroundColor Yellow

if ($OpenLogin) {
  Start-Process $loginUrl | Out-Null
  Write-Host 'Opened login URL in default browser.' -ForegroundColor Green
}

if ([string]::IsNullOrWhiteSpace($RequestToken) -and -not [string]::IsNullOrWhiteSpace($RedirectUrl)) {
  $RequestToken = Get-RequestTokenFromUrl -url $RedirectUrl
}

$headers = @{ 'X-Kite-Version' = '3' }
$accessToken = ''

if (-not [string]::IsNullOrWhiteSpace($RefreshToken)) {
  $refreshChecksum = Get-Sha256Hex "$ApiKey$RefreshToken$ApiSecret"
  $refreshBody = @{
    api_key = $ApiKey
    refresh_token = $RefreshToken
    checksum = $refreshChecksum
  }

  Write-Host 'Requesting refreshed access token from Zerodha...' -ForegroundColor Cyan
  $response = Invoke-RestMethod -Method Post -Uri 'https://api.kite.trade/session/refresh_token' -Headers $headers -Body $refreshBody
} else {
  if ([string]::IsNullOrWhiteSpace($RequestToken)) {
    throw "Could not determine credentials for token generation. Set ZERODHA_REFRESH_TOKEN for renewal, or set ZERODHA_REQUEST_TOKEN / ZERODHA_REDIRECT_URL in $CredsFile, or pass -RefreshToken/-RequestToken/-RedirectUrl."
  }

  $checksum = Get-Sha256Hex "$ApiKey$RequestToken$ApiSecret"
  $body = @{
    api_key = $ApiKey
    request_token = $RequestToken
    checksum = $checksum
  }

  Write-Host 'Requesting session token from Zerodha...' -ForegroundColor Cyan
  $response = Invoke-RestMethod -Method Post -Uri 'https://api.kite.trade/session/token' -Headers $headers -Body $body
}

if (-not $response -or $response.status -ne 'success') {
  throw 'Token exchange failed.'
}

$data = $response.data
$accessToken = [string]$data.access_token
$refreshToken = [string]$data.refresh_token

Write-Host ''
Write-Host 'Token exchange success.' -ForegroundColor Green
Write-Host ("access_token present : {0}" -f (-not [string]::IsNullOrWhiteSpace($accessToken)))
Write-Host ("refresh_token present: {0}" -f (-not [string]::IsNullOrWhiteSpace($refreshToken)))
Write-Host ''

if (-not [string]::IsNullOrWhiteSpace($accessToken)) {
  Write-Host "ACCESS_TOKEN: $accessToken" -ForegroundColor Yellow
}
if (-not [string]::IsNullOrWhiteSpace($refreshToken)) {
  Write-Host "REFRESH_TOKEN: $refreshToken" -ForegroundColor Yellow
} else {
  Write-Host 'REFRESH_TOKEN is empty. This usually means your app is not enabled for refresh tokens.' -ForegroundColor DarkYellow
}

if ($SaveToCreds) {
  Save-TokensToCreds -filePath $CredsFile -requestToken $RequestToken -accessToken $accessToken -refreshToken $refreshToken
  Write-Host "Saved token(s) to $CredsFile" -ForegroundColor Green
} else {
  Write-Host "Tokens not saved. Set ZERODHA_SAVE_TOKENS=true in $CredsFile or pass -SaveToCreds to persist them." -ForegroundColor DarkYellow
}

Write-Host 'Done.' -ForegroundColor Cyan
