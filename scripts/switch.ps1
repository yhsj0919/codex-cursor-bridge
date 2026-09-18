$ErrorActionPreference = 'Stop'
function Get-LocalizedText([string]$Value) {
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

function Wait-ForCodexExit {
  while (@(Get-Process -Name 'ChatGPT', 'codex' -ErrorAction SilentlyContinue).Count -gt 0) {
    $answer = Read-Host (Get-LocalizedText '5YiH5o2i5YmN6ZyA6KaB5a6M5YWo6YCA5Ye6IENvZGV444CC6K+36YCA5Ye657O757uf5omY55uY5Lit55qEIENvZGV477yM54S25ZCO5oyJ5Zue6L2m6YeN6K+V77yb6L6T5YWlIDAg5Y+W5raI')
    if ($answer -eq '0') { return $false }
  }
  return $true
}

function Invoke-ProviderSwitch([string]$Provider) {
  if (-not (Wait-ForCodexExit)) {
    Write-Host (Get-LocalizedText '5bey5Y+W5raI5YiH5o2i44CC') -ForegroundColor Yellow
    return
  }
  & node dist\codex\switch.js $Provider
  if ($LASTEXITCODE -eq 0) {
    Write-Host (Get-LocalizedText '5YiH5o2i5a6M5oiQ44CC5L2g5Y+v5Lul57un57ut6YCJ5oup5YW25LuW5pON5L2c44CC') -ForegroundColor Green
  } else {
    Write-Host (Get-LocalizedText '5YiH5o2i5aSx6LSl77yM6K+35p+l55yL5LiK6Z2i55qE6ZSZ6K+v5L+h5oGv44CC') -ForegroundColor Red
  }
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

while ($true) {
  Clear-Host
  Write-Host (Get-LocalizedText 'Q29kZXgg5qih5Z6L5p2l5rqQ566h55CG') -ForegroundColor Cyan
  Write-Host '------------------------'
  & node dist\codex\switch.js status
  Write-Host ''
  Write-Host (Get-LocalizedText 'MS4g5YiH5o2i5YiwIENvZGV4IOWumOaWueaooeWeiw==')
  Write-Host (Get-LocalizedText 'Mi4g5YiH5o2i5YiwIEN1cnNvciDmqKHlnos=')
  Write-Host (Get-LocalizedText 'My4g5p+l55yLL+WIt+aWsOW9k+WJjeeKtuaAgQ==')
  Write-Host (Get-LocalizedText 'MC4g6YCA5Ye6')
  $choice = Read-Host (Get-LocalizedText '6K+36YCJ5oup')

  switch ($choice) {
    '1' { Invoke-ProviderSwitch 'codex' }
    '2' { Invoke-ProviderSwitch 'cursor' }
    '3' { & node dist\codex\switch.js status }
    '0' { exit 0 }
    default { Write-Host (Get-LocalizedText '5peg5pWI6YCJ5oup44CC') -ForegroundColor Yellow }
  }
  Read-Host (Get-LocalizedText '5oyJ5Zue6L2m6ZSu6L+U5Zue6I+c5Y2V') | Out-Null
}
