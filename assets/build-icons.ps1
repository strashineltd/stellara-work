# Stellara Work icon generation script
# Converts assets/icon.jpg to .ico + multi-size .png (for electron-builder)
# Requires ImageMagick: winget install ImageMagick.ImageMagick
# Usage: powershell -ExecutionPolicy Bypass -File assets/build-icons.ps1

$ErrorActionPreference = 'Stop'

$SourceIcon = Join-Path $PSScriptRoot 'icon.jpg'
$OutputDir = $PSScriptRoot

# Check source file
if (-not (Test-Path $SourceIcon)) {
    Write-Error "Source not found: $SourceIcon"
    exit 1
}

# Check magick command
if (-not (Get-Command 'magick' -ErrorAction SilentlyContinue)) {
    Write-Error "magick not found. Install ImageMagick first: winget install ImageMagick.ImageMagick"
    exit 1
}

Write-Host ">> Generating multi-size icons..." -ForegroundColor Cyan

# Generate multi-size .ico (16/32/48/64/128/256)
$icoPath = Join-Path $OutputDir 'icon.ico'
magick $SourceIcon `
    -define icon:auto-resize=256,128,64,48,32,16 `
    $icoPath
Write-Host "   OK: icon.ico"

# Generate each size .png
$sizes = @(16, 32, 48, 64, 128, 256, 512)
foreach ($size in $sizes) {
    $pngPath = Join-Path $OutputDir "icon-$size.png"
    magick $SourceIcon -resize "${size}x${size}" $pngPath
    Write-Host "   OK: icon-$size.png"
}

# Also generate 256x256 (electron-builder common)
$icon256Path = Join-Path $OutputDir 'icon-256.png'
if (-not (Test-Path $icon256Path)) {
    magick $SourceIcon -resize '256x256' $icon256Path
}

# Generate 1024x1024 (Apple store / large)
$icon1024Path = Join-Path $OutputDir 'icon-1024.png'
if (-not (Test-Path $icon1024Path)) {
    magick $SourceIcon -resize '1024x1024' $icon1024Path
}

Write-Host ">> Done! Output to $OutputDir" -ForegroundColor Green
Get-ChildItem $OutputDir -Filter 'icon*' | Select-Object Name, Length | Format-Table
