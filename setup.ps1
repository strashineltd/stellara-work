# Stellara Work 一键安装脚本
#
# 用法：powershell -ExecutionPolicy Bypass -File setup.ps1
# 这一步装 npm 依赖。better-sqlite3 是原生模块，需要编译。
# 前置：Node.js 20+ 和 Visual Studio Build Tools（"使用 C++ 的桌面开发"）

$ErrorActionPreference = 'Stop'

Write-Host "▶ 检查 Node.js..." -ForegroundColor Cyan
$nodeVersion = node --version
Write-Host "  ✓ Node.js $nodeVersion"
if ([version]($nodeVersion -replace 'v', '') -lt [version]'20.0.0') {
    Write-Error "需要 Node.js 20+，当前 $nodeVersion"
    exit 1
}

Write-Host "▶ 检查 npm..." -ForegroundColor Cyan
$npmVersion = npm --version
Write-Host "  ✓ npm $npmVersion"

Write-Host "▶ 安装依赖..." -ForegroundColor Cyan
Write-Host "  （这会编译 better-sqlite3 原生模块，可能需要 3-5 分钟）"
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install 失败"
    exit 1
}

Write-Host "▶ 跑测试..." -ForegroundColor Cyan
npm test

if ($LASTEXITCODE -ne 0) {
    Write-Warning "测试有失败项"
}

Write-Host ""
Write-Host "▶ 完成！接下来：" -ForegroundColor Green
Write-Host "  1. 在 ~/.stellara/.env 填入 API key"
Write-Host "  2. 跑 npm run dev 启动开发模式"
Write-Host "  3. 或跑 npm run verify:w1 验证 W1 后端逻辑"
Write-Host ""
