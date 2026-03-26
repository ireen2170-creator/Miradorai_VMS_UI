#!/usr/bin/env powershell
<#
.SYNOPSIS
    MIRADOR VMS - Complete Startup Script
    
.DESCRIPTION
    Starts Docker, builds/starts all containers, waits for services to be ready
    
.PARAMETER Force
    Force restart even if containers are running
    
.PARAMETER Rebuild
    Rebuild Docker images before starting
    
.EXAMPLE
    .\startup.ps1
    .\startup.ps1 -Rebuild
    .\startup.ps1 -Force -Rebuild
#>

param(
    [switch]$Force,
    [switch]$Rebuild
)

# Color functions
function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Info { Write-Host $args -ForegroundColor Cyan }
function Write-Warn { Write-Host $args -ForegroundColor Yellow }
function Write-Error { Write-Host $args -ForegroundColor Red }

# Set working directory
$VMS_DIR = "D:\Kiru\VMS\Mirador_VMS_UI"
Set-Location $VMS_DIR

Write-Info "════════════════════════════════════════════════════════════════════════════════"
Write-Info "  🚀 MIRADOR VMS - Startup Script"
Write-Info "════════════════════════════════════════════════════════════════════════════════"

# ─────────────────────────────────────────────────────────────────────────────────
# 1. Ensure Docker is running
# ─────────────────────────────────────────────────────────────────────────────────
Write-Info "`n📦 Checking Docker daemon..."
$maxRetries = 5
$retries = 0
$dockerReady = $false

while ($retries -lt $maxRetries -and -not $dockerReady) {
    try {
        $result = docker ps -q 2>&1
        if ($LASTEXITCODE -eq 0) {
            $dockerReady = $true
            Write-Success "✅ Docker daemon is running"
        } else {
            throw "Docker error"
        }
    } catch {
        Write-Warn "   ⏳ Docker not ready yet, starting Docker Desktop..."
        if ($retries -eq 0) {
            # First attempt: start Docker Desktop
            try {
                Start-Process "C:\Program Files\Docker\Docker\Docker.exe" -ErrorAction SilentlyContinue
            } catch {
                Write-Error "   ❌ Could not start Docker Desktop"
            }
        }
        Start-Sleep -Seconds 5
        $retries++
    }
}

if (-not $dockerReady) {
    Write-Error "   ❌ Docker daemon could not be started"
    Write-Warn "Please manually start Docker Desktop and try again"
    exit 1
}

# ─────────────────────────────────────────────────────────────────────────────────
# 2. Check if containers are already running
# ─────────────────────────────────────────────────────────────────────────────────
Write-Info "`n🔍 Checking existing containers..."
$containerCount = (docker-compose ps -q 2>/dev/null | Measure-Object -Line).Lines

if ($containerCount -ge 3 -and -not $Force) {
    Write-Success "✅ Containers already running"
    Write-Info "`n📊 Current Status:"
    docker-compose ps
} else {
    # ─────────────────────────────────────────────────────────────────────────────────
    # 3. Start/Rebuild containers
    # ─────────────────────────────────────────────────────────────────────────────────
    Write-Info "`n🚀 Starting containers..."
    
    if ($Rebuild) {
        Write-Warn "   (Rebuilding images - this may take 2-3 minutes)"
        docker-compose up -d --build 2>&1 | ForEach-Object {
            if ($_ -like "*error*") { Write-Error "   $_" } else { Write-Warn "   $_" }
        }
    } else {
        docker-compose up -d 2>&1 | ForEach-Object {
            if ($_ -like "*error*") { Write-Error "   $_" } else { Write-Warn "   $_" }
        }
    }
    
    # ─────────────────────────────────────────────────────────────────────────────────
    # 4. Wait for containers to be ready
    # ─────────────────────────────────────────────────────────────────────────────────
    Write-Info "`n⏳ Waiting for services to start..."
    Start-Sleep -Seconds 3
    
    Write-Info "`n📊 Container Status:"
    docker-compose ps
    
    # ─────────────────────────────────────────────────────────────────────────────────
    # 5. Wait for backend to be healthy
    # ─────────────────────────────────────────────────────────────────────────────────
    Write-Info "`n⏳ Waiting for backend API to be ready..."
    $maxWait = 40
    $waited = 0
    $backendReady = $false
    
    while ($waited -lt $maxWait -and -not $backendReady) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:8000/api/recordings/cameras" `
                -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                $backendReady = $true
                Write-Success "✅ Backend API is responding"
            }
        } catch {
            Write-Warn "   Checking... ($waited / $maxWait sec)" -NoNewline
            Start-Sleep -Seconds 1
            $waited++
        }
    }
    
    if (-not $backendReady) {
        Write-Warn "⚠️  Backend still warming up, but containers are running"
        Write-Warn "   Check status with: docker logs mirador-backend"
    }
}

# ─────────────────────────────────────────────────────────────────────────────────
# 6. Check encryption key
# ─────────────────────────────────────────────────────────────────────────────────
Write-Info "`n🔐 Checking encryption key..."
try {
    $keyCheck = docker exec mirador-backend ls -l /app/data/video.key 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "✅ Encryption key found"
    } else {
        Write-Error "   ❌ Encryption key not found - backups cannot be restored"
    }
} catch {
    Write-Warn "   Could not verify key (backend may still be starting)"
}

# ─────────────────────────────────────────────────────────────────────────────────
# 7. Summary
# ─────────────────────────────────────────────────────────────────────────────────
Write-Info "`n════════════════════════════════════════════════════════════════════════════════"
Write-Success "✅ VMS Startup Complete!"
Write-Info "════════════════════════════════════════════════════════════════════════════════"

Write-Info "`n🌐 Access:"
Write-Info "   Frontend:  http://localhost:5173"
Write-Info "   API:       http://localhost:8000"
Write-Info "   MongoDB:   localhost:27017"

Write-Info "`n📝 View Logs:"
Write-Info "   .\logs.ps1"
Write-Info "   or manually:"
Write-Info "   docker logs -f mirador-backend"
Write-Info "   docker logs -f mirador-mongo"
Write-Info "   docker logs -f mirador-ome"

Write-Info "`n🔐 Backup Encryption Key:"
Write-Info "   .\scripts\backup-encryption-key.ps1"

Write-Info "`n🛑 Stop Services:"
Write-Info "   docker-compose down"

Write-Info "`n════════════════════════════════════════════════════════════════════════════════"
