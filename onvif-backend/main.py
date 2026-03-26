from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient
from datetime import datetime
import asyncio
import json
import os
import re
import requests as http_requests
from ome_service import register_stream
from onvif_service import probe_camera, move_camera_ptz
from discovery_service import discover_onvif_devices, discover_onvif_devices_simple
import rtsp_recorder as recorder
import encrypt_service
import recording_api
from recording_api import recording_router
import shutil

app = FastAPI(title="MIRADOR ONVIF Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(recording_router)

DEVICES_FILE      = "/app/data/devices.json"
OME_API           = "http://localhost:8081"
OME_AUTH          = "Basic bXl2bXNhY2Nlc3N0b2tlbg=="
WATCHDOG_INTERVAL = 10
MONGO_URI         = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")

# ------------------------------------------------------------------
# MongoDB
# ------------------------------------------------------------------
_mongo      = MongoClient(MONGO_URI)
_db         = _mongo["mirador-vms"]
cameras_col = _db["cameras"]


# ------------------------------------------------------------------
# devices.json helpers
# ------------------------------------------------------------------
def load_devices():
    try:
        if os.path.exists(DEVICES_FILE):
            with open(DEVICES_FILE) as f:
                return json.load(f)
    except:
        pass
    return []


def save_devices(devs):
    os.makedirs(os.path.dirname(DEVICES_FILE), exist_ok=True)
    with open(DEVICES_FILE, "w") as f:
        json.dump(devs, f)


def stream_exists_in_ome(stream_name: str) -> bool:
    try:
        r = http_requests.get(
            f"{OME_API}/v1/vhosts/default/apps/app/streams/{stream_name}",
            headers={"Authorization": OME_AUTH},
            timeout=3,
        )
        return r.status_code == 200
    except:
        return False


devices = load_devices()


# ------------------------------------------------------------------
# Helper: probe camera via ONVIF → return clean RTSP URL
# ------------------------------------------------------------------
async def probe_and_get_rtsp(ip: str, port: int = 80,
                              username: str = "", password: str = "") -> str | None:
    """
    Probe a camera via ONVIF using the given credentials.
    Returns a clean RTSP URL or None if the probe fails.
    """
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(probe_camera, ip, port, username, password),
            timeout=60.0,
        )
        if result.get("success") and result.get("stream_uri"):
            rtsp = result["stream_uri"]
            if username:
                rtsp = rtsp.replace("rtsp://", f"rtsp://{username}:{password}@")
            rtsp = re.sub(r"[&?]proto=Onvif", "", rtsp)
            print(f"[PROBE] ✅ Got RTSP for {ip}: {rtsp}")
            return rtsp
        else:
            print(f"[PROBE] ❌ Probe failed for {ip}: {result.get('error', 'no stream_uri')}")
            return None
    except asyncio.TimeoutError:
        print(f"[PROBE] ⏰ Timeout probing {ip}")
        return None
    except Exception as e:
        print(f"[PROBE] ❌ Exception probing {ip}: {e}")
        return None


# ------------------------------------------------------------------
# OME stream watchdog
# ------------------------------------------------------------------
async def stream_watchdog():
    await asyncio.sleep(5)
    while True:
        for device in list(devices):
            stream_name = device.get("ome_stream")
            rtsp_url    = device.get("rtsp_url")
            if not stream_name or not rtsp_url:
                continue
            if not stream_exists_in_ome(stream_name):
                print(f"[WATCHDOG] ⚠️  Stream {stream_name} is down — re-registering...")
                try:
                    result = register_stream(stream_name, rtsp_url)
                    print(f"[WATCHDOG] ✅ Re-registered {stream_name}: {result}")
                except Exception as e:
                    print(f"[WATCHDOG] ❌ Failed: {e}")
            else:
                print(f"[WATCHDOG] ✓ {stream_name} is live")
        await asyncio.sleep(WATCHDOG_INTERVAL)


# ------------------------------------------------------------------
# Startup / shutdown
# ------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    print(f"[STARTUP] Starting with {len(devices)} saved devices")
    for device in devices:
        stream_name = device.get("ome_stream")
        rtsp_url    = device.get("rtsp_url")
        if stream_name and rtsp_url:
            print(f"[STARTUP] Registering stream: {stream_name}")
            register_stream(stream_name, rtsp_url)

    asyncio.create_task(stream_watchdog())
    encrypt_service.start_watcher()
    recorder.start_recording_all(devices)
    print(f"[STARTUP] 🎥 Recording started for {len(devices)} camera(s)")


@app.on_event("shutdown")
async def shutdown():
    print("[SHUTDOWN] Stopping recorders and encryption watcher...")
    recorder.stop_all()
    encrypt_service.stop_watcher()


# ------------------------------------------------------------------
# Request models
# ------------------------------------------------------------------
class ProbeRequest(BaseModel):
    ip: str
    port: int = 80
    username: str = ""
    password: str = ""


class StreamRegisterRequest(BaseModel):
    rtsp_url:     str = ""      # empty = will probe via ONVIF using ip + credentials
    ip:           str = ""      # camera IP — used for ONVIF probe when rtsp_url is absent
    port:         int = 80
    username:     str = ""      # camera ONVIF/RTSP username (entered during enrollment)
    password:     str = ""      # camera ONVIF/RTSP password (entered during enrollment)
    # Discovery metadata
    manufacturer: str = "Unknown"
    model:        str = "Unknown"
    mac:          str = "—"
    device_name:  str = ""


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/play")
async def play_upload(file: UploadFile = File(...)):
    """Accept an uploaded .enc file, decrypt it, and stream as MP4."""
    if not file.filename.lower().endswith(".enc"):
        raise HTTPException(status_code=400, detail="Only .enc files are supported")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        decrypted_stream = recording_api.decrypt_bytes(data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decryption failed: {str(e)}")

    return StreamingResponse(decrypted_stream, media_type="video/mp4")


@app.post("/api/onvif/probe")
async def onvif_probe(req: ProbeRequest):
    print(f"[ONVIF] Probing {req.ip}:{req.port} ...")
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(probe_camera, req.ip, req.port, req.username, req.password),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        print(f"[ONVIF] ⏰ Probe timeout for {req.ip}:{req.port}")
        return {
            "success": False,
            "error": f"Probe timeout after 60 seconds for {req.ip}:{req.port}",
            "manufacturer": "", "model": "", "firmware": "",
            "serial": "", "stream_uri": "", "profiles": [],
            "ptz": "No", "port": req.port,
        }
    except Exception as e:
        print(f"[ONVIF] ❌ Probe error for {req.ip}:{req.port}: {str(e)}")
        return {
            "success": False,
            "error": f"Probe failed: {str(e)}",
            "manufacturer": "", "model": "", "firmware": "",
            "serial": "", "stream_uri": "", "profiles": [],
            "ptz": "No", "port": req.port,
        }

    if result["success"]:
        print(f"[ONVIF] ✅ {result['manufacturer']} {result['model']}")
        rtsp = result["stream_uri"]
        if req.username:
            rtsp = rtsp.replace("rtsp://", f"rtsp://{req.username}:{req.password}@")
        rtsp = re.sub(r"[&?]proto=Onvif", "", rtsp)

        stream_name = req.ip.replace(".", "_")
        existing = next((d for d in devices if d.get("ome_stream") == stream_name), None)

        if not existing or not stream_exists_in_ome(stream_name):
            print("REGISTERING STREAM IN OME:", stream_name)
            ome_response = register_stream(stream_name, rtsp)
            print("OME RESPONSE:", ome_response)

            if not existing:
                devices.append({"ome_stream": stream_name, "rtsp_url": rtsp, "ip": req.ip})
            else:
                existing["rtsp_url"] = rtsp
            save_devices(devices)

            try:
                cameras_col.update_one(
                    {"ip": req.ip},
                    {"$set": {
                        "ip":           req.ip,
                        "ome_stream":   stream_name,
                        "rtsp_url":     rtsp,
                        "manufacturer": result.get("manufacturer", ""),
                        "model":        result.get("model", ""),
                        "mac":          result.get("mac", ""),
                        "port":         req.port,
                        "username":     req.username,
                        "added_at":     datetime.utcnow(),
                        "status":       "streaming",
                    }},
                    upsert=True,
                )
                print(f"[MONGO] 📷 Camera saved: {req.ip}")
            except Exception as e:
                print(f"[MONGO] ⚠ Camera save failed: {e}")

            recorder.start_camera(stream_name, rtsp)
            print(f"[ONVIF] 🎥 Recording started for {stream_name}")
        else:
            print(f"[ONVIF] Stream {stream_name} already live in OME, skipping.")
            ome_response = {"message": "Already registered", "statusCode": 200}

        from ome_service import get_ws_url
        result["ome_stream"]   = stream_name
        result["ome_response"] = ome_response
        result["ws_url"]       = get_ws_url(stream_name)
        result["stream_key"]   = stream_name
        result["status"]       = "streaming"
        result["rtsp_url"]     = rtsp
    else:
        print(f"[ONVIF] ❌ {result['error']}")

    return result


# ------------------------------------------------------------------
# Register camera stream by direct RTSP URL
# ------------------------------------------------------------------
@app.post("/api/streams/register-direct")
async def register_stream_direct(req: StreamRegisterRequest):
    rtsp_url = req.rtsp_url.strip()
    if not rtsp_url:
        return {"success": False, "error": "RTSP URL is required"}
    if not rtsp_url.lower().startswith("rtsp://"):
        return {"success": False, "error": "URL must start with rtsp://"}

    try:
        from urllib.parse import urlparse
        parsed      = urlparse(rtsp_url)
        ip          = parsed.hostname or "unknown"
        stream_name = ip.replace(".", "_")

        print(f"[STREAM] Registering direct stream for {ip}: {rtsp_url}")
        ome_response = register_stream(stream_name, rtsp_url)
        print(f"[STREAM] OME response: {ome_response}")

        if ome_response and ome_response.get("statusCode") == 200:
            existing = next((d for d in devices if d.get("ip") == ip), None)
            if not existing:
                devices.append({"ip": ip, "ome_stream": stream_name,
                                 "rtsp_url": rtsp_url, "method": "direct_url"})
            else:
                existing["rtsp_url"] = rtsp_url
            save_devices(devices)

            try:
                cameras_col.update_one(
                    {"ip": ip},
                    {"$set": {
                        "ip": ip, "ome_stream": stream_name, "rtsp_url": rtsp_url,
                        "manufacturer": "Manual", "model": "Direct Stream",
                        "added_at": datetime.utcnow(), "status": "streaming",
                        "method": "direct_url",
                    }},
                    upsert=True,
                )
                print(f"[MONGO] 📷 Camera saved: {ip}")
            except Exception as e:
                print(f"[MONGO] ⚠ Save failed: {e}")

            recorder.start_camera(stream_name, rtsp_url)

            from ome_service import get_ws_url
            return {
                "success": True, "ip": ip, "ome_stream": stream_name,
                "rtsp_url": rtsp_url, "ws_url": get_ws_url(stream_name),
                "status": "streaming", "ome_response": ome_response,
            }
        else:
            return {"success": False, "error": f"OME registration failed: {ome_response}"}

    except Exception as e:
        print(f"[STREAM] ❌ Error: {str(e)}")
        return {"success": False, "error": str(e)}


# ------------------------------------------------------------------
# Discover ONVIF devices — NO credentials needed, just finds IPs
# ------------------------------------------------------------------
@app.get("/api/discover-devices")
async def discover_devices(subnet: str = ""):
    """
    Scan the network for cameras. No credentials required at this stage.
    Credentials are collected per-camera during the enrollment step.
    """
    try:
        print(f"[DISCOVERY] Starting (subnet: {subnet or 'auto'})")

        discovered_devices = []

        # WS-Discovery first (no credentials needed)
        discovered_devices = await asyncio.to_thread(discover_onvif_devices, 10)
        print(f"[DISCOVERY] WS-Discovery found {len(discovered_devices)} device(s)")

        # Fallback: subnet scan
        if not discovered_devices:
            print("[DISCOVERY] Falling back to subnet scan...")
            if subnet:
                from discovery_service import discover_onvif_devices_simple as discovery_func
                old_subnet = os.environ.get("HOST_SUBNET", "")
                os.environ["HOST_SUBNET"] = subnet
                try:
                    # Pass empty credentials — just scanning, not probing
                    discovered_devices = await asyncio.to_thread(discovery_func, 5, "", "")
                finally:
                    if old_subnet:
                        os.environ["HOST_SUBNET"] = old_subnet
                    elif "HOST_SUBNET" in os.environ:
                        del os.environ["HOST_SUBNET"]
            else:
                discovered_devices = await asyncio.to_thread(
                    discover_onvif_devices_simple, 5, "", ""
                )
            print(f"[DISCOVERY] Subnet scan found {len(discovered_devices)} device(s)")

        # Also include already-known devices from devices.json
        known_devices = load_devices()
        print(f"[DISCOVERY] Loaded {len(known_devices)} known device(s)")

        known_devices_formatted = []
        for dev in known_devices:
            if not isinstance(dev, dict) or 'ip' not in dev:
                continue
            ip         = dev.get('ip', 'unknown')
            ome_stream = dev.get('ome_stream', '')

            if 'axis' in ome_stream.lower():
                manufacturer = 'Axis'
                model        = 'Network Camera'
                device_name  = f"Axis Camera {ip.split('.')[-1]}"
            else:
                manufacturer = 'Network Device'
                model        = ''
                device_name  = f"Camera {ip.split('.')[-1]}"

            known_devices_formatted.append({
                'id':           f"device-{ip}",
                'ip':           ip,
                'mac':          dev.get('mac', 'Unknown'),
                'name':         device_name,
                'status':       'online',
                'manufacturer': manufacturer,
                'model':        model,
                'rtsp_url':     dev.get('rtsp_url', ''),
                'stream_uri':   dev.get('rtsp_url', ''),
                'source':       'known',
            })

        # Merge + deduplicate by IP
        all_devices = discovered_devices + known_devices_formatted
        seen_ips = {}
        for dev in all_devices:
            ip = dev.get('ip', '')
            if not ip:
                continue
            if ip not in seen_ips:
                seen_ips[ip] = dev
            else:
                existing = seen_ips[ip]
                if dev.get('manufacturer') and dev['manufacturer'] != 'Unknown':
                    if not existing.get('manufacturer') or existing['manufacturer'] == 'Unknown':
                        seen_ips[ip] = dev

        unique_devices = list(seen_ips.values())
        print(f"[DISCOVERY] Merged to {len(unique_devices)} total device(s)")

        return {
            "devices":   unique_devices,
            "count":     len(unique_devices),
            "timestamp": datetime.utcnow().isoformat(),
            "success":   True,
        }

    except Exception as e:
        print(f"[DISCOVERY] Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return {
            "devices":   [],
            "count":     0,
            "timestamp": datetime.utcnow().isoformat(),
            "success":   False,
            "error":     str(e),
        }


# ------------------------------------------------------------------
# Register RTSP stream — probes via ONVIF with credentials if rtsp_url missing
# ------------------------------------------------------------------
@app.post("/api/streams/register")
async def register_rtsp_stream(req: StreamRegisterRequest):
    rtsp = req.rtsp_url.strip() if req.rtsp_url else ""

    # ── Step 1: no RTSP URL → probe via ONVIF using enrollment credentials ────
    if not rtsp:
        ip = req.ip.strip()
        if not ip:
            return {
                "success": False,
                "error":   "Either rtsp_url or ip must be provided.",
            }

        print(f"[RTSP] No rtsp_url for {ip} — probing via ONVIF (user={req.username or 'none'})...")
        rtsp = await probe_and_get_rtsp(ip, req.port, req.username, req.password)

        if not rtsp:
            return {
                "success": False,
                "error":   (
                    f"ONVIF probe failed for {ip}. "
                    "Check that the credentials are correct and the camera is reachable."
                ),
            }

        print(f"[RTSP] ✅ Probed RTSP for {ip}: {rtsp}")

    # ── Step 2: validate ──────────────────────────────────────────────────────
    if not rtsp.lower().startswith("rtsp://"):
        return {"success": False, "error": "URL must start with rtsp://"}

    # ── Step 3: derive stream name ────────────────────────────────────────────
    try:
        from urllib.parse import urlparse
        parsed    = urlparse(rtsp)
        host      = parsed.hostname or "unknown"
        path_slug = parsed.path.strip("/").replace("/", "_") if parsed.path.strip("/") else ""
        stream_name = host.replace(".", "_") + (f"_{path_slug}" if path_slug else "")
    except Exception:
        stream_name = re.sub(r"[^a-zA-Z0-9]", "_", rtsp)[:32]
        host        = req.ip or "unknown"

    print(f"[RTSP] stream_name={stream_name}  rtsp={rtsp}")

    # ── Step 4: already live? ─────────────────────────────────────────────────
    existing = next((d for d in devices if d.get("ome_stream") == stream_name), None)
    if existing and stream_exists_in_ome(stream_name):
        print(f"[RTSP] {stream_name} already live in OME — skipping.")
        from ome_service import get_ws_url
        return {
            "success":    True,
            "ome_stream": stream_name,
            "ws_url":     get_ws_url(stream_name),
            "stream_key": stream_name,
            "status":     "streaming",
            "rtsp_url":   rtsp,
        }

    # ── Step 5: register with OME ─────────────────────────────────────────────
    try:
        ome_response = register_stream(stream_name, rtsp)
        print(f"[RTSP] OME response: {ome_response}")
        status_code = ome_response.get("statusCode", 0) if isinstance(ome_response, dict) else 0
        if status_code not in (200, 201, 409):
            err_msg = (
                ome_response.get("message", "OME registration failed")
                if isinstance(ome_response, dict) else str(ome_response)
            )
            print(f"[RTSP] ❌ OME rejected ({status_code}): {err_msg}")
            return {"success": False, "error": err_msg}
    except Exception as e:
        print(f"[RTSP] ❌ OME exception: {e}")
        return {"success": False, "error": str(e)}

    # ── Step 6: persist to devices.json ──────────────────────────────────────
    if not existing:
        devices.append({"ome_stream": stream_name, "rtsp_url": rtsp, "ip": host})
    else:
        existing["rtsp_url"] = rtsp
    save_devices(devices)

    # ── Step 7: persist to MongoDB ────────────────────────────────────────────
    try:
        cameras_col.update_one(
            {"ome_stream": stream_name},
            {"$set": {
                "ip":           host,
                "ome_stream":   stream_name,
                "rtsp_url":     rtsp,
                "manufacturer": req.manufacturer,
                "model":        req.model,
                "mac":          req.mac,
                "name":         req.device_name or f"Camera @ {host}",
                "username":     req.username,
                "added_at":     datetime.utcnow(),
                "status":       "streaming",
                "source":       "discovery",
            }},
            upsert=True,
        )
        print(f"[MONGO] 📷 Saved: {stream_name} ({req.manufacturer} {req.model})")
    except Exception as e:
        print(f"[MONGO] ⚠  Save failed (non-fatal): {e}")

    # ── Step 8: start recording ───────────────────────────────────────────────
    recorder.start_camera(stream_name, rtsp)
    print(f"[RTSP] 🎥 Recording started for {stream_name}")

    from ome_service import get_ws_url
    return {
        "success":    True,
        "ome_stream": stream_name,
        "ws_url":     get_ws_url(stream_name),
        "stream_key": stream_name,
        "status":     "streaming",
        "rtsp_url":   rtsp,
    }


# ------------------------------------------------------------------
# Device CRUD
# ------------------------------------------------------------------
@app.post("/api/devices/")
async def add_device(device: dict):
    print("DEVICE REGISTERED:", device)
    existing = next(
        (d for d in devices if d.get("ip_address") == device.get("ip_address")), None
    )
    if existing:
        devices.remove(existing)
    devices.append(device)
    save_devices(devices)
    return {"success": True, "device": device}


@app.get("/api/devices/")
async def get_devices():
    return devices


@app.get("/api/cameras/")
async def get_cameras_from_db():
    docs = list(cameras_col.find({}, {"_id": 0}))
    return docs


# ------------------------------------------------------------------
# Storage
# ------------------------------------------------------------------
@app.get("/api/storage/management")
def storage_management():
    recordings_dir = os.environ.get("RECORDINGS_DIR", "/recordings")
    try:
        total, used, free = shutil.disk_usage(recordings_dir)
        status = "Intruding data"
    except Exception:
        total, used, free = 0, 0, 0
        status = "Unavailable"

    return [{
        "location":  "C:\\Recording",
        "type":      "Local Disk",
        "total":     round(total / (1024**3), 1),
        "used":      round(used  / (1024**3), 1),
        "free":      round(free  / (1024**3), 1),
        "status":    status,
        "server":    "MIRADOR",
        "allocated": 352,
    }]


@app.get("/api/storage/selection")
def storage_selection():
    docs = list(cameras_col.find({}, {"_id": 0}))
    result = []
    for cam in docs:
        stream         = cam.get("ome_stream", "")
        recordings_dir = os.environ.get("RECORDINGS_DIR", "/recordings")
        cam_dir        = os.path.join(recordings_dir, stream)

        used_bytes = 0
        oldest     = None
        if os.path.exists(cam_dir):
            for root, dirs, files in os.walk(cam_dir):
                for f in files:
                    fp = os.path.join(root, f)
                    try:
                        used_bytes += os.path.getsize(fp)
                        mtime = os.path.getmtime(fp)
                        if oldest is None or mtime < oldest:
                            oldest = mtime
                    except:
                        pass

        used_gb    = round(used_bytes / (1024**3), 2)
        oldest_str = datetime.fromtimestamp(oldest).strftime("%d-%m-%Y %H:%M:%S") if oldest else "N/A"

        result.append({
            "device":           f"{cam.get('manufacturer', '')} {cam.get('model', '')}".strip() or cam.get("ip"),
            "ip":               cam.get("ip"),
            "used_storage":     f"{used_gb} GB",
            "location":         "C:\\Recording",
            "retention":        cam.get("retention_days", 70),
            "oldest_recording": oldest_str,
            "failover":         cam.get("failover", False),
        })
    return result


@app.post("/api/storage/selection")
def update_storage_selection(payload: dict):
    ip = payload.get("ip")
    if not ip:
        return {"error": "ip required"}
    cameras_col.update_one(
        {"ip": ip},
        {"$set": {
            "retention_days": payload.get("retention_days", 70),
            "failover":       payload.get("failover", False),
            "store_to":       payload.get("store_to", "C:\\Recording"),
        }}
    )
    return {"success": True}


# ------------------------------------------------------------------
# PTZ
# ------------------------------------------------------------------
class PTZMoveRequest(BaseModel):
    ip: str
    port: int = 80
    username: str = ""
    password: str = ""
    pan: float = 0.0
    tilt: float = 0.0
    zoom: float = 0.0


@app.post("/api/onvif/ptz/move")
async def ptz_move(req: PTZMoveRequest):
    print(f"[PTZ] Moving {req.ip} to P:{req.pan} T:{req.tilt} Z:{req.zoom}")
    result = await asyncio.to_thread(
        move_camera_ptz,
        req.ip, req.port, req.username, req.password,
        req.pan, req.tilt, req.zoom
    )
    return result