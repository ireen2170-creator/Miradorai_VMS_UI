from fastapi import FastAPI, HTTPException
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
OME_API           = "http://ome:8081"
OME_AUTH          = "Basic bXl2bXNhY2Nlc3N0b2tlbg=="
WATCHDOG_INTERVAL = 10
MONGO_URI         = os.environ.get("MONGO_URI", "mongodb://mongo:27017/")

# ------------------------------------------------------------------
# MongoDB — single DB "mirador-vms", collection "cameras"
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


def delete_stream_from_ome(stream_name: str):
    try:
        http_requests.delete(
            f"{OME_API}/v1/vhosts/default/apps/app/streams/{stream_name}",
            headers={"Authorization": OME_AUTH},
            timeout=3,
        )
    except Exception as e:
        print(f"[OME DELETE] Failed for {stream_name}: {e}")


devices = load_devices()


# ------------------------------------------------------------------
# OME stream watchdog — only watches devices in devices.json
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
# Routes
# ------------------------------------------------------------------
class ProbeRequest(BaseModel):
    ip: str
    port: int = 80
    username: str = ""
    password: str = ""


class StreamRegisterRequest(BaseModel):
    rtsp_url: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/onvif/probe")
async def onvif_probe(req: ProbeRequest):
    print(f"[ONVIF] Probing {req.ip}:{req.port} ...")
    result = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password
    )

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
                new_device = {"ome_stream": stream_name, "rtsp_url": rtsp, "ip": req.ip}
                devices.append(new_device)
                save_devices(devices)
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
                    upsert=True
                )
                print(f"[MONGO] 📷 Camera saved: {req.ip} → mirador-vms/cameras")
            except Exception as e:
                print(f"[MONGO] ⚠ Camera save failed: {e}")

            recorder.start_camera(stream_name, rtsp)
            print(f"[ONVIF] 🎥 Recording started for {stream_name}")

        else:
            print(f"[ONVIF] Stream {stream_name} already live in OME, skipping.")
            ome_response = {"message": "Already registered", "statusCode": 200}

        result["ome_stream"]   = stream_name
        result["ome_response"] = ome_response
        result["ws_url"]       = f"ws://192.168.126.100:3333/app/{stream_name}"
        result["stream_key"]   = stream_name
        result["status"]       = "streaming"
        result["rtsp_url"]     = rtsp
    else:
        print(f"[ONVIF] ❌ {result['error']}")

    return result


# ------------------------------------------------------------------
# NEW: Discover ONVIF devices on network using WS-Discovery
# ------------------------------------------------------------------
@app.get("/api/discover-devices")
async def discover_devices(username: str = "", password: str = ""):
    """
    Auto-discover ONVIF cameras on the network.
    Automatically detects local subnet and finds real cameras.
    Uses optional credentials to probe cameras for detailed info.
    
    Query params:
      username: ONVIF camera username (optional)
      password: ONVIF camera password (optional)
    """
    try:
        print(f"[DISCOVERY] Starting ONVIF device discovery (creds: {bool(username)})")
        
        # Try WS-Discovery first (faster, more reliable)
        devices = await asyncio.to_thread(discover_onvif_devices, 10)
        print(f"[DISCOVERY] WS-Discovery found {len(devices)} device(s)")
        
        # If WS-Discovery fails, fall back to subnet scanning with auto-detection
        if not devices:
            print("[DISCOVERY] WS-Discovery found no devices, trying subnet scan...")
            devices = await asyncio.to_thread(discover_onvif_devices_simple, 5, username, password)
            print(f"[DISCOVERY] Subnet scan found {len(devices)} device(s)")
        
        print(f"[DISCOVERY] Returning {len(devices)} device(s) to frontend")
        
        return {
            "devices": devices,
            "count": len(devices),
            "timestamp": datetime.utcnow().isoformat(),
            "success": True
        }
    except Exception as e:
        print(f"[DISCOVERY] Fatal error: {e}")
        import traceback
        traceback.print_exc()
        
        # Return empty list instead of error
        return {
            "devices": [],
            "count": 0,
            "timestamp": datetime.utcnow().isoformat(),
            "success": False,
            "error": str(e)
        }


# ------------------------------------------------------------------
# NEW: Register a raw RTSP stream URL directly (no ONVIF probe)
# ------------------------------------------------------------------
@app.post("/api/streams/register")
async def register_rtsp_stream(req: StreamRegisterRequest):
    rtsp = req.rtsp_url.strip()
    print(f"[RTSP] Registering stream: {rtsp}")

    try:
        from urllib.parse import urlparse
        parsed      = urlparse(rtsp)
        host        = parsed.hostname or "unknown"
        path_slug   = parsed.path.strip("/").replace("/", "_") if parsed.path.strip("/") else ""
        stream_name = host.replace(".", "_") + (f"_{path_slug}" if path_slug else "")
    except Exception:
        stream_name = re.sub(r"[^a-zA-Z0-9]", "_", rtsp)[:32]

    existing = next((d for d in devices if d.get("ome_stream") == stream_name), None)
    if existing and stream_exists_in_ome(stream_name):
        print(f"[RTSP] Stream {stream_name} already live in OME, skipping.")
        return {
            "success":     True,
            "ome_stream":  stream_name,
            "ws_url":      f"ws://192.168.126.100:3333/app/{stream_name}",
            "stream_key":  stream_name,
            "status":      "streaming",
            "rtsp_url":    rtsp,
        }

    try:
        ome_response = register_stream(stream_name, rtsp)
        print(f"[RTSP] OME response: {ome_response}")
    except Exception as e:
        print(f"[RTSP] ❌ OME registration failed: {e}")
        return {"success": False, "error": str(e)}

    if not existing:
        new_device = {"ome_stream": stream_name, "rtsp_url": rtsp, "ip": host}
        devices.append(new_device)
    else:
        existing["rtsp_url"] = rtsp
    save_devices(devices)

    try:
        cameras_col.update_one(
            {"ome_stream": stream_name},
            {"$set": {
                "ip":           host,
                "ome_stream":   stream_name,
                "rtsp_url":     rtsp,
                "manufacturer": "Unknown",
                "model":        "Unknown",
                "mac":          "—",
                "added_at":     datetime.utcnow(),
                "status":       "streaming",
                "source":       "rtsp_url",
            }},
            upsert=True
        )
        print(f"[MONGO] 📷 RTSP stream saved: {stream_name}")
    except Exception as e:
        print(f"[MONGO] ⚠ Save failed: {e}")

    recorder.start_camera(stream_name, rtsp)
    print(f"[RTSP] 🎥 Recording started for {stream_name}")

    return {
        "success":     True,
        "ome_stream":  stream_name,
        "ws_url":      f"ws://192.168.126.100:3333/app/{stream_name}",
        "stream_key":  stream_name,
        "status":      "streaming",
        "rtsp_url":    rtsp,
    }


# ------------------------------------------------------------------
# DELETE camera — stops streaming, recording, and removes from DB
# ------------------------------------------------------------------
@app.delete("/api/cameras/{stream_name}")
async def delete_camera(stream_name: str):
    global devices

    # 1. Remove from in-memory list and save
    before = len(devices)
    devices = [d for d in devices if d.get("ome_stream") != stream_name]
    save_devices(devices)
    print(f"[DELETE] Removed {stream_name} from devices.json ({before} → {len(devices)})")

    # 2. Stop OME stream
    delete_stream_from_ome(stream_name)
    print(f"[DELETE] Stopped OME stream: {stream_name}")

    # 3. Stop recorder
    try:
        recorder.stop_camera(stream_name)
        print(f"[DELETE] Stopped recording: {stream_name}")
    except Exception as e:
        print(f"[DELETE] Recorder stop error: {e}")

    # 4. Remove from MongoDB
    result = cameras_col.delete_one({"ome_stream": stream_name})
    print(f"[DELETE] MongoDB removed {result.deleted_count} doc(s) for {stream_name}")

    return {"success": True, "deleted": stream_name}


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
    """Return all cameras stored in MongoDB mirador-vms/cameras."""
    docs = list(cameras_col.find({}, {"_id": 0}))
    return docs


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
        "location": "C:\\Recording",
        "type": "Local Disk",
        "total": round(total / (1024**3), 1),
        "used": round(used / (1024**3), 1),
        "free": round(free / (1024**3), 1),
        "status": status,
        "server": "MIRADOR",
        "allocated": 352,
    }]


@app.get("/api/storage/selection")
def storage_selection():
    docs = list(cameras_col.find({}, {"_id": 0}))
    result = []
    for cam in docs:
        stream = cam.get("ome_stream", "")
        recordings_dir = os.environ.get("RECORDINGS_DIR", "/recordings")
        cam_dir = os.path.join(recordings_dir, stream)

        used_bytes = 0
        oldest = None
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

        used_gb = round(used_bytes / (1024**3), 2)
        oldest_str = datetime.fromtimestamp(oldest).strftime("%d-%m-%Y %H:%M:%S") if oldest else "N/A"

        result.append({
            "device": f"{cam.get('manufacturer', '')} {cam.get('model', '')}".strip() or cam.get("ip"),
            "ip": cam.get("ip"),
            "used_storage": f"{used_gb} GB",
            "location": "C:\\Recording",
            "retention": cam.get("retention_days", 70),
            "oldest_recording": oldest_str,
            "failover": cam.get("failover", False),
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
            "failover": payload.get("failover", False),
            "store_to": payload.get("store_to", "C:\\Recording"),
        }}
    )
    return {"success": True}


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

@app.get("/api/recordings/{stream_name}")
async def get_recordings(stream_name: str, date: str = ""):
    recordings_dir = os.environ.get("RECORDINGS_DIR", "/recordings")
    cam_dir = os.path.join(recordings_dir, stream_name)
    if date:
        cam_dir = os.path.join(cam_dir, date)
    files = []
    if os.path.exists(cam_dir):
        for f in sorted(os.listdir(cam_dir)):
            if f.endswith(".mp4"):
                fp = os.path.join(cam_dir, f)
                size = os.path.getsize(fp)
                files.append({
                    "name": f,
                    "size": f"{round(size / (1024**2), 1)} MB",
                    "path": fp,
                })
    return {"files": files, "count": len(files)}

@app.get("/api/recordings/file/{stream_name}/{filename}")
async def serve_recording(stream_name: str, filename: str):
    from fastapi.responses import FileResponse
    recordings_dir = os.environ.get("RECORDINGS_DIR", "/recordings")
    # Search recursively for the file
    for root, dirs, files in os.walk(os.path.join(recordings_dir, stream_name)):
        if filename in files:
            return FileResponse(
                os.path.join(root, filename),
                media_type="video/mp4",
                headers={"Accept-Ranges": "bytes"}
            )
    raise HTTPException(status_code=404, detail="Recording not found")