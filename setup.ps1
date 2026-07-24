# Stellara Work one-line setup script
# Usage: powershell -ExecutionPolicy Bypass -File setup.ps1
# Steps: check Node -> npm install -> npm test

$ErrorActionPreference = 'Stop'

Write-Host ">> Checking Node.js..." -ForegroundColor Cyan
$nodeVersion = node --version
Write-Host "   OK: Node.js $nodeVersion"
if ([version]($nodeVersion -replace 'v', '') -lt [version]'20.0.0') {
    Write-Error "Need Node.js 20+, current $nodeVersion"
    exit 1
}

Write-Host ">> Checking npm..." -ForegroundColor Cyan
$npmVersion = npm --version
Write-Host "   OK: npm $npmVersion"

Write-Host ">> Installing dependencies (compiles better-sqlite3, ~3-5 min)..." -ForegroundColor Cyan
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "!! npm install failed." -ForegroundColor Red
    Write-Host "   Common fixes:" -ForegroundColor Yellow
    Write-Host "   - Install Visual Studio Build Tools (C++ desktop dev workload)"
    Write-Host "   - Install Python 3 and add to PATH"
    Write-Host "   - Run: npm config set python 'D:\python318\python.exe'"
    exit 1
}

Write-Host ">> Running tests..." -ForegroundColor Cyan
npm test

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "!! Some tests failed. Check output above." -ForegroundColor Yellow
    Write-Host "   After fixing, re-run: npm test"
}

Write-Host ""
Write-Host ">> Setup complete!" -ForegroundColor Green
Write-Host "   Next steps:"
Write-Host "   1. Fill API key in ~/.stellara/.env"
Write-Host "   2. Run: npm run dev   (development mode with HMR)"
Write-Host "   3. Or:  npm run verify:w1   (validate W1 backend end-to-end)"
Write-Host ""
