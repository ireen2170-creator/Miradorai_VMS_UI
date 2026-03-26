# ═══════════════════════════════════════════════════════════════════════════════
# MIRADOR VMS - Complete Startup & Troubleshooting Guide
# ═══════════════════════════════════════════════════════════════════════════════

## 🚀 Quick Start (Do This First)

### Step 1: Restart Docker Desktop
```powershell
# Option A: Via Control Panel
Settings → Apps → Docker Desktop → Uninstall → Reinstall

# Option B: Via PowerShell (Admin)
Stop-Process -Name "Docker Desktop" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5
Start-Process "C:\Program Files\Docker\Docker\Docker.exe"
Start-Sleep -Seconds 30  # Wait for daemon to start
```

### Step 2: Navigate to VMS folder
```powershell
cd D:\Kiru\VMS\Mirador_VMS_UI
```

### Step 3: Start all containers
```powershell
docker-compose up -d
```

### Step 4: Verify containers running
```powershell
docker-compose ps
# Should show: mirador-ome, mirador-mongo, mirador-backend all "Up"
```

### Step 5: Check backend logs
```powershell
docker logs mirador-backend
# Should show: "Uvicorn running on 0.0.0.0:8000"
```

### Step 6: Reload browser
```
http://localhost:5173
# Try .enc file again
```

---

## ❌ If .enc File Still Not Opening

### Symptom 1: "Loading..." forever

**Cause**: Backend not responding to decrypt-file endpoint

**Fix**:
```powershell
# Check if backend is listening on port 8000
netstat -an | findstr :8000

# If not listening, rebuild backend
docker-compose down
docker-compose build --no-cache backend
docker-compose up -d
```

### Symptom 2: "Failed to decrypt .enc file" message

**Cause**: Encryption key file corrupted or missing

**Fix**:
```powershell
# Check if key exists in container
docker exec mirador-backend ls -l /app/data/

# Should show: video.key (32 bytes)

# If missing, restore from backup
.\scripts\restore-encryption-key.ps1 -KeyFile ".\backups\video.key.latest"
```

### Symptom 3: Backend container crashes on startup

**Cause**: MongoDB not connected or volume issue

**Fix**:
```powershell
# Check mongo container
docker logs mirador-mongo

# Restart stack with volume reset
docker-compose down -v
docker-compose up -d

# Wait 10 seconds for mongo to start
Start-Sleep -Seconds 10
docker logs mirador-backend
```

---

## 🔍 Full Diagnostics Command

Run this to check everything at once:

```powershell
Write-Host "=== Docker Status ===" -ForegroundColor Cyan
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

Write-Host "`n=== Container Logs ===" -ForegroundColor Cyan
Write-Host "Backend:" -ForegroundColor Yellow
docker logs --tail 20 mirador-backend

Write-Host "`nMongo:" -ForegroundColor Yellow
docker logs --tail 5 mirador-mongo

Write-Host "`n=== Network Test ===" -ForegroundColor Cyan
$response = Invoke-WebRequest -Uri "http://localhost:8000/api/recordings/cameras" -ErrorAction SilentlyContinue
if ($response.StatusCode -eq 200) {
    Write-Host "✅ Backend responding on port 8000" -ForegroundColor Green
} else {
    Write-Host "❌ Backend NOT responding" -ForegroundColor Red
}

Write-Host "`n=== Encryption Key ===" -ForegroundColor Cyan
docker exec mirador-backend ls -lh /app/data/video.key 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Key file exists" -ForegroundColor Green
} else {
    Write-Host "❌ Key file missing" -ForegroundColor Red
}
```

---

## 📋 Complete Startup Script

Save this as `startup.ps1` and run it:

```powershell
param(
    [switch]$Force,
    [switch]$Rebuild
)

$VMS_DIR = "D:\Kiru\VMS\Mirador_VMS_UI"
cd $VMS_DIR

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  MIRADOR VMS - Startup Script" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan

# Check Docker running
Write-Host "`n📦 Checking Docker..." -ForegroundColor Yellow
$docker = docker ps 2>&1
if ($docker -like "*error*") {
    Write-Host "❌ Docker daemon not responding" -ForegroundColor Red
    Write-Host "   Starting Docker Desktop..." -ForegroundColor Yellow
    Start-Process "C:\Program Files\Docker\Docker\Docker.exe"
    Start-Sleep -Seconds 20
}

# Check if containers already running
Write-Host "`n🔍 Checking existing containers..." -ForegroundColor Yellow
$running = docker-compose ps --services 2>/dev/null | Measure-Object | ForEach-Object Count
if ($running -gt 0 -and -not $Force) {
    Write-Host "✅ Containers already running" -ForegroundColor Green
    docker-compose ps
} else {
    # Start containers
    Write-Host "`n🚀 Starting containers..." -ForegroundColor Yellow
    if ($Rebuild) {
        Write-Host "   (Rebuilding images)" -ForegroundColor Gray
        docker-compose up -d --build
    } else {
        docker-compose up -d
    }
    
    # Wait for services
    Write-Host "`n⏳ Waiting for services to start..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    # Show status
    Write-Host "`n📊 Container Status:" -ForegroundColor Yellow
    docker-compose ps
    
    # Wait for backend ready
    Write-Host "`n⏳ Waiting for backend to be ready..." -ForegroundColor Yellow
    $retries = 0
    while ($retries -lt 30) {
        $health = Invoke-WebRequest -Uri "http://localhost:8000/api/recordings/cameras" `
            -ErrorAction SilentlyContinue
        if ($health.StatusCode -eq 200) {
            Write-Host "✅ Backend is ready" -ForegroundColor Green
            break
        }
        Write-Host "   Checking... ($($retries+1)/30)" -ForegroundColor Gray
        Start-Sleep -Seconds 2
        $retries++
    }
    
    if ($retries -eq 30) {
        Write-Host "⚠️  Backend not responding yet, but containers are running" -ForegroundColor Yellow
        Write-Host "   Check logs with: docker logs mirador-backend" -ForegroundColor Yellow
    }
}

Write-Host "`n✅ Startup complete!" -ForegroundColor Green
Write-Host "   Open: http://localhost:5173" -ForegroundColor Cyan
Write-Host "`n📝 Logs:" -ForegroundColor Yellow
Write-Host "   Backend:  docker logs -f mirador-backend" -ForegroundColor Gray
Write-Host "   MongoDB:  docker logs -f mirador-mongo" -ForegroundColor Gray
Write-Host "   OME:      docker logs -f mirador-ome" -ForegroundColor Gray

Write-Host "`n═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
```

---

## 🛠️ Docker Reset (Nuclear Option)

If container issues persist:

```powershell
# DANGER: This removes ALL VMS containers and volumes!
Write-Host "⚠️  WARNING: This will delete all containers and local volumes" -ForegroundColor Red
$confirm = Read-Host "Type 'RESET' to continue"

if ($confirm -eq "RESET") {
    cd D:\Kiru\VMS\Mirador_VMS_UI
    
    # Stop and remove everything
    docker-compose down -v
    
    # Remove images (optional)
    docker rmi $(docker images -q mirador-* 2>/dev/null) 2>/dev/null
    
    # Prune system (optional)
    docker system prune -a --volumes -f
    
    # Rebuild and start fresh
    docker-compose up -d --build
    
    Write-Host "✅ System reset and restarted" -ForegroundColor Green
}
```

---

## 🌐 Port Accessibility

Ensure these ports are not blocked:

| Service | Port | URL |
|---------|------|-----|
| Frontend | 5173 | http://localhost:5173 |
| Backend API | 8000 | http://localhost:8000 |
| MongoDB | 27017 | localhost:27017 |
| OME | 3333, 8080, 8081 | Various |

Check port usage:
```powershell
# See what's using port 8000
netstat -ano | findstr :8000

# Kill process if needed
$pid = (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue).OwningProcess
if ($pid) { Stop-Process -Id $pid -Force }
```

---

## 📞 Still Not Working?

1. **Check Docker Desktop logs**:
   - Open Docker Desktop → Troubleshoot → Show Log Files

2. **Rebuild everything**:
   ```powershell
   .\startup.ps1 -Rebuild -Force
   ```

3. **Check browser console** (F12):
   - Open DevTools → Console tab
   - Look for error messages when selecting .enc file

4. **Test API directly**:
   ```powershell
   Invoke-WebRequest http://localhost:8000/api/recordings/cameras -Headers @{Accept='application/json'}
   ```

5. **Restart Windows**:
   - Sometimes Docker daemon needs clean system restart

---

## ✅ Success Checklist

- [ ] Docker Desktop running
- [ ] All 3 containers up: `docker-compose ps`
- [ ] Backend logs show "Uvicorn running": `docker logs mirador-backend`
- [ ] http://localhost:8000/api/recordings/cameras returns JSON
- [ ] http://localhost:5173 loads in browser
- [ ] Logged in as Admin
- [ ] Media Player accessible
- [ ] Can select .enc file and it plays
- [ ] Backup script runs: `.\scripts\backup-encryption-key.ps1`

---

Last Updated: 2025-03-23
