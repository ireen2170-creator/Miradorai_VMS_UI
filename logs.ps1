#!/usr/bin/env powershell
<#
.SYNOPSIS
    View MIRADOR VMS logs
.DESCRIPTION
    Tail logs from all containers in real-time
#>

Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  📋 MIRADOR VMS - Live Logs" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan

Write-Host "`nSelect which service to view:" -ForegroundColor Yellow
Write-Host "  [1] Backend API"
Write-Host "  [2] MongoDB"
Write-Host "  [3] OME Media Engine"
Write-Host "  [4] All services (split view)"
Write-Host "  [Q] Quit" -ForegroundColor Gray

$choice = Read-Host "`nChoice"

switch ($choice.ToUpper()) {
    "1" {
        Write-Host "`n🔗 Backend logs (Press Ctrl+C to stop):" -ForegroundColor Green
        docker logs -f mirador-backend
    }
    "2" {
        Write-Host "`n🗄️  MongoDB logs (Press Ctrl+C to stop):" -ForegroundColor Green
        docker logs -f mirador-mongo
    }
    "3" {
        Write-Host "`n📡 OME logs (Press Ctrl+C to stop):" -ForegroundColor Green
        docker logs -f mirador-ome
    }
    "4" {
        Write-Host "`n📊 All services:" -ForegroundColor Green
        Write-Host "`nBackend:" -ForegroundColor Yellow
        docker logs --tail 30 mirador-backend
        Write-Host "`nMongo:" -ForegroundColor Yellow
        docker logs --tail 30 mirador-mongo
        Write-Host "`nOME:" -ForegroundColor Yellow
        docker logs --tail 10 mirador-ome
    }
    default {
        Write-Host "Cancelled" -ForegroundColor Gray
    }
}
