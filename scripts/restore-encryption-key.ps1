# ─────────────────────────────────────────────────────────────────
# Restore Encryption Key Script
# ─────────────────────────────────────────────────────────────────
# This script restores a backed-up encryption key to a Docker container
# Usage: .\restore-encryption-key.ps1 -KeyFile "path/to/video.key.backup-20250323_120000"
# ─────────────────────────────────────────────────────────────────

param(
    [Parameter(Mandatory=$true)]
    [string]$KeyFile,
    [string]$ContainerName = "mirador-backend"
)

Write-Host "🔐 Restoring encryption key..." -ForegroundColor Cyan

if (-not (Test-Path $KeyFile)) {
    Write-Host "❌ Key file not found: $KeyFile" -ForegroundColor Red
    exit 1
}

Write-Host "📍 Using key file: $KeyFile" -ForegroundColor Yellow

try {
    # Check if container is running
    $containerStatus = docker ps --filter "name=$ContainerName" --format "{{.State}}"
    
    if ([string]::IsNullOrEmpty($containerStatus)) {
        Write-Host "⚠️  Container '$ContainerName' is not running" -ForegroundColor Yellow
        Write-Host "   Starting container..." -ForegroundColor Yellow
        docker-compose up -d $ContainerName
        Start-Sleep -Seconds 3
    }
    
    # Restore key to container
    Write-Host "📦 Copying key to Docker container..." -ForegroundColor Yellow
    docker cp $KeyFile "${ContainerName}:/app/data/video.key"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Key restored successfully" -ForegroundColor Green
        Write-Host "🔒 All encrypted recordings should now be decryptable" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to restore key to container" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ Restoration complete" -ForegroundColor Green
