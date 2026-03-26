# ========================================================================
# Restore Encryption Key Script
# ========================================================================
# This script restores a backed-up encryption key to a Docker container
# Usage: .\restore-encryption-key.ps1 -KeyFile "path/to/video.key.backup-20250323_120000"
# ========================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$KeyFile,
    [string]$ContainerName = "mirador-backend"
)

Write-Host "[KEY RESTORE] Starting encryption key restore..." -ForegroundColor Cyan

if (-not (Test-Path $KeyFile)) {
    Write-Host "[ERROR] Key file not found: $KeyFile" -ForegroundColor Red
    exit 1
}

Write-Host "[PATH] Using key file: $KeyFile" -ForegroundColor Yellow

try {
    # Check if container is running
    $containerStatus = docker ps --filter "name=$ContainerName" --format "{{.State}}"
    
    if ([string]::IsNullOrEmpty($containerStatus)) {
        Write-Host "[WARNING] Container '$ContainerName' is not running" -ForegroundColor Yellow
        Write-Host "[ACTION] Starting container..." -ForegroundColor Yellow
        docker-compose up -d $ContainerName
        Start-Sleep -Seconds 3
    }
    
    # Restore key to container
    Write-Host "[ACTION] Copying key to Docker container..." -ForegroundColor Yellow
    docker cp $KeyFile "${ContainerName}:/app/data/video.key"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Key restored successfully" -ForegroundColor Green
        Write-Host "[INFO] All encrypted recordings should now be decryptable" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Failed to restore key to container" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "[ERROR] Exception: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n[COMPLETE] Restoration complete" -ForegroundColor Green
