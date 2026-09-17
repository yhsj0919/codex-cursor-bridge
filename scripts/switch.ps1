$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$running = @(Get-Process -Name 'ChatGPT', 'codex' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) { throw '请先从系统托盘完全退出 Codex，再切换模型来源。' }
Write-Host '1. Codex 官方模型'
Write-Host '2. Cursor 模型'
$choice = Read-Host '请选择'
if ($choice -eq '1') { node dist\codex\switch.js codex }
elseif ($choice -eq '2') { node dist\codex\switch.js cursor }
else { throw '无效选择。' }
Read-Host '按回车键退出'
