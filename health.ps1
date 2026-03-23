#!/usr/bin/env powershell
<#
.SYNOPSIS
    Check VMS system health
#>

Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  🏥 MIRADOR VMS - Health Check" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan

# Check Docker
Write-Host "`n📦 Docker:" -ForegroundColor Yellow
try {
    $docker = docker ps -q
    Write-Host "   ✅ Docker running" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Docker not responding" -ForegroundColor Red
    exit 1
}

# Check containers
Write-Host "`n🐳 Containers:" -ForegroundColor Yellow
$containers = docker-compose ps --format "{{.Service}}\t{{.Status}}"
$containers | ForEach-Object {
    if ($_ -like "*Up*") {
        Write-Host "   ✅ $_" -ForegroundColor Green
    } elseif ($_ -like "*Exit*") {
        Write-Host "   ❌ $_" -ForegroundColor Red
    } else {
        Write-Host "   ⚠️  $_" -ForegroundColor Yellow
    }
}

# Check API
Write-Host "`n🌐 API Endpoints:" -ForegroundColor Yellow
try {
    $api = Invoke-WebRequest -Uri "http://localhost:8000/api/recordings/cameras" -ErrorAction SilentlyContinue
    if ($api.StatusCode -eq 200) {
        Write-Host "   ✅ http://localhost:8000 responding" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Status: $($api.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ http://localhost:8000 not responding" -ForegroundColor Red
}

# Check frontend
Write-Host "`n🌐 Frontend:" -ForegroundColor Yellow
try {
    $web = Invoke-WebRequest -Uri "http://localhost:5173" -ErrorAction SilentlyContinue
    if ($web.StatusCode -eq 200) {
        Write-Host "   ✅ http://localhost:5173 responding" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Status: $($web.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ http://localhost:5173 not responding" -ForegroundColor Red
}

# Check encryption key
Write-Host "`n🔐 Encryption Key:" -ForegroundColor Yellow
try {
    docker exec mirador-backend ls /app/data/video.key > $null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ Key file exists" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Key file missing" -ForegroundColor Red
    }
} catch {
    Write-Host "   ⚠️  Could not verify key" -ForegroundColor Yellow
}

# Check backups
Write-Host "`n💾 Backups:" -ForegroundColor Yellow
$backups = Get-ChildItem "./backups/*.backup*" 2>/dev/null | Measure-Object | Select-Object -ExpandProperty Count
if ($backups -gt 0) {
    Write-Host "   ✅ $backups backup(s) found" -ForegroundColor Green
    Get-ChildItem "./backups/*.backup*" 2>/dev/null | Select-Object -First 3 | ForEach-Object {
        Write-Host "      - $(Split-Path $_.FullName -Leaf)" -ForegroundColor Gray
    }
} else {
    Write-Host "   ⚠️  No backups found - RUN BACKUP IMMEDIATELY!" -ForegroundColor Red
}

Write-Host "`n════════════════════════════════════════════════════════════════" -ForegroundColor Cyan

$allGood = ($containers | Where-Object { $_ -like "*Up*" }).Count -eq 3
if ($allGood) {
    Write-Host "`n✅ All systems operational!" -ForegroundColor Green
} else {
    Write-Host "`n⚠️  Some systems not running - run: .\startup.ps1" -ForegroundColor Yellow
}
