# Stellara Work 图标生成脚本
#
# 把 assets/icon.jpg 转成 electron-builder 需要的 .ico + 多尺寸 .png
# 用 ImageMagick（magick 命令）
#
# 前置：安装 ImageMagick
#   winget install ImageMagick.ImageMagick
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File assets/build-icons.ps1

$ErrorActionPreference = 'Stop'

$SourceIcon = Join-Path $PSScriptRoot 'icon.jpg'
$OutputDir = $PSScriptRoot

# 检查源文件
if (-not (Test-Path $SourceIcon)) {
    Write-Error "未找到源文件：$SourceIcon"
    exit 1
}

# 检查 magick 命令
if (-not (Get-Command 'magick' -ErrorAction SilentlyContinue)) {
    Write-Error "未找到 magick 命令。请先安装 ImageMagick：winget install ImageMagick.ImageMagick"
    exit 1
}

Write-Host "▶ 生成多尺寸图标..."

# 生成多尺寸 .ico（包含 16/32/48/64/128/256）
$icoPath = Join-Path $OutputDir 'icon.ico'
magick $SourceIcon `
    -define icon:auto-resize=256,128,64,48,32,16 `
    $icoPath

# 生成各尺寸 .png
$sizes = @(16, 32, 48, 64, 128, 256, 512)
foreach ($size in $sizes) {
    $pngPath = Join-Path $OutputDir "icon-$size.png"
    magick $SourceIcon -resize "${size}x${size}" $pngPath
    Write-Host "  ✓ icon-$size.png"
}

# 同时生成 256x256（electron-builder 通用）
$icon256Path = Join-Path $OutputDir 'icon-256.png'
if (-not (Test-Path $icon256Path)) {
    magick $SourceIcon -resize '256x256' $icon256Path
}

# 生成 1024x1024（Apple store / 大尺寸需求）
$icon1024Path = Join-Path $OutputDir 'icon-1024.png'
if (-not (Test-Path $icon1024Path)) {
    magick $SourceIcon -resize '1024x1024' $icon1024Path
}

Write-Host "▶ 完成！输出到 $OutputDir"
Get-ChildItem $OutputDir -Filter 'icon*' | Select-Object Name, Length | Format-Table
