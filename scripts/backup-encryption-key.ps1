# ─────────────────────────────────────────────────────────────────
# Backup Encryption Key Script
# ─────────────────────────────────────────────────────────────────
# This script backs up the AES-256 encryption key used for recording encryption
# Usage: .\backup-encryption-key.ps1
# ─────────────────────────────────────────────────────────────────

param(
    [string]$BackupDir = "$PSScriptRoot/../backups",
    [string]$ContainerName = "mirador-backend"
)

Write-Host "🔐 Backing up encryption key..." -ForegroundColor Cyan

# Create backup directory if it doesn't exist
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
    Write-Host "📁 Created backup directory: $BackupDir" -ForegroundColor Green
}

# Generate timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "$BackupDir/video.key.backup-$timestamp"

try {
    # Copy key from Docker named volume
    Write-Host "📦 Extracting key from Docker container..." -ForegroundColor Yellow
    
    docker cp "${ContainerName}:/app/data/video.key" "$backupFile"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Key backed up successfully" -ForegroundColor Green
        Write-Host "📍 Location: $backupFile" -ForegroundColor Green
        
        # Also keep a "latest" copy
        Copy-Item -Path $backupFile -Destination "$BackupDir/video.key.latest" -Force
        Write-Host "🔗 Latest copy: $BackupDir/video.key.latest" -ForegroundColor Green
        
        Write-Host "`n⚠️  IMPORTANT: Store this key in a secure location (e.g., password manager, encrypted cloud storage)" -ForegroundColor Red
        Write-Host "   Without this key, you cannot decrypt any encrypted recordings!" -ForegroundColor Red
    } else {
        Write-Host "❌ Failed to backup key from container" -ForegroundColor Red
        Write-Host "   Ensure Docker is running and container '$ContainerName' exists" -ForegroundColor Red
        exit 1
    }
} 
catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}
