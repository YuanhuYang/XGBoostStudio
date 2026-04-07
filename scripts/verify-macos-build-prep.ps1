#Requires -Version 5.1
<#
.SYNOPSIS
  Local check (Windows): optional bash -n on build-all.sh, plus uv x86_64-apple-darwin tarball extract sanity.
  Does not replace a real macOS PyInstaller/Electron build.
.PARAMETER SkipBashSyntax
  Skip bash -n when Git Bash is not installed.
#>
param([switch]$SkipBashSyntax)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$VerifyTag = if ($env:UV_VERIFY_TAG) { $env:UV_VERIFY_TAG } else { '0.11.3' }
$LegacyTag = '0.8.14'

function Get-GitBashExe {
    @(
        (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}

function ConvertTo-MsysBashPath {
    param([string]$WindowsPath)
    if ($WindowsPath -match '^([A-Za-z]):[/\\](.+)$') {
        $drive = $Matches[1].ToLower()
        $rest = ($Matches[2] -replace '\\', '/')
        return "/$drive/$rest"
    }
    return ($WindowsPath -replace '\\', '/')
}

function Test-UvDarwinTarball {
    param([string]$Tag)
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        $tgz = Join-Path $tmp 'uv.tgz'
        $url = "https://github.com/astral-sh/uv/releases/download/$Tag/uv-x86_64-apple-darwin.tar.gz"
        & curl.exe -fsSL -o $tgz $url
        & tar.exe -xzf $tgz -C $tmp
        $uv = Get-ChildItem -Path $tmp -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq 'uv' -and $_.Extension -ne '.tgz' } |
            Select-Object -First 1
        if (-not $uv -or $uv.Length -lt 1) {
            throw "After extract, uv binary not found or empty (tag=$Tag)."
        }
    }
    finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

if (-not $SkipBashSyntax) {
    $gitBash = Get-GitBashExe
    if ($gitBash) {
        Write-Host '==> bash -n scripts/build-all.sh (Git Bash)'
        $shPath = ConvertTo-MsysBashPath (Join-Path $Root 'scripts/build-all.sh')
        & $gitBash -n -- $shPath
        if ($LASTEXITCODE -ne 0) {
            throw "bash -n failed (exit $LASTEXITCODE)."
        }
    }
    else {
        Write-Warning 'Git Bash not found; skipping bash -n. Install Git for Windows or pass -SkipBashSyntax.'
    }
}

Write-Host "==> Fetch/extract uv $VerifyTag (darwin x86_64 tarball layout)..."
Test-UvDarwinTarball -Tag $VerifyTag
Write-Host "==> Fetch/extract uv $LegacyTag (legacy flat layout)..."
Test-UvDarwinTarball -Tag $LegacyTag

Write-Host '[ok] macOS build prep checks passed.'
