# ========================================================================
# Backup Encryption Key Script
# ========================================================================
# This script backs up the AES-256 encryption key used for recording encryption
# Usage: .\backup-encryption-key.ps1
# ========================================================================

param(
    [string]$BackupDir = "$PSScriptRoot/../backups",
    [string]$ContainerName = "mirador-backend"
)

Write-Host "[KEY BACKUP] Starting encryption key backup..." -ForegroundColor Cyan

# Create backup directory if it doesn't exist
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
    Write-Host "[BACKUP] Created backup directory: $BackupDir" -ForegroundColor Green
}

# Generate timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "$BackupDir/video.key.backup-$timestamp"

try {
    # Copy key from Docker named volume
    Write-Host "[BACKUP] Extracting key from Docker container..." -ForegroundColor Yellow
    
    docker cp "${ContainerName}:/app/data/video.key" "$backupFile"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Key backed up successfully" -ForegroundColor Green
        Write-Host "[PATH] Location: $backupFile" -ForegroundColor Green
        
        # Also keep a "latest" copy
        Copy-Item -Path $backupFile -Destination "$BackupDir/video.key.latest" -Force
        Write-Host "[LATEST] Latest copy: $BackupDir/video.key.latest" -ForegroundColor Green
        
        Write-Host "`n[WARNING] IMPORTANT: Store this key in a secure location (password manager, encrypted cloud storage)" -ForegroundColor Red
        Write-Host "[WARNING] Without this key, you cannot decrypt any encrypted recordings!" -ForegroundColor Red
    } else {
        Write-Host "[ERROR] Failed to backup key from container" -ForegroundColor Red
        Write-Host "[ERROR] Ensure Docker is running and container exists: $ContainerName" -ForegroundColor Red
        exit 1
    }
} 
catch {
    Write-Host "[ERROR] Exception: $_" -ForegroundColor Red
    exit 1
}
