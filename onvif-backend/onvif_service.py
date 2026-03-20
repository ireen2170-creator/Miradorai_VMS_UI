from onvif import ONVIFCamera
import asyncio

def probe_camera(ip: str, port: int, username: str, password: str) -> dict:
    """
    Connect to an ONVIF camera and return device info + stream URI.
    If initial port fails, tries common ONVIF ports (80, 443, 8080, 8081, 8888).
    Runs synchronously — called via asyncio.to_thread from FastAPI.
    """
    
    # Always try specified port first, then fallback to common ONVIF ports
    common_ports = [80, 443, 8080, 8081, 8888, 8443]
    if port and port > 0:
        ports_to_try = [port] + [p for p in common_ports if p != port]
    else:
        ports_to_try = common_ports
    
    # Remove duplicates while preserving order
    ports_to_try = list(dict.fromkeys(ports_to_try))
    
    for attempt_port in ports_to_try:
        try:
            print(f"[ONVIF] Attempting connection to {ip}:{attempt_port}")
            cam = ONVIFCamera(ip, attempt_port, username, password)

            # ── Device Information ──────────────────────────────────────
            device_service = cam.create_devicemgmt_service()
            info = device_service.GetDeviceInformation()

            # ── Stream URI ──────────────────────────────────────────────
            media_service = cam.create_media_service()
            profiles      = media_service.GetProfiles()

            stream_uri  = "Unavailable"
            profile_list = []

            if profiles:
                # Get stream URI from first profile
                stream_setup = media_service.create_type("GetStreamUri")
                stream_setup.ProfileToken     = profiles[0].token
                stream_setup.StreamSetup      = {"Stream": "RTP-Unicast", "Transport": {"Protocol": "RTSP"}}
                stream_response               = media_service.GetStreamUri(stream_setup)
                stream_uri                    = stream_response.Uri

                # Build profile list
                for p in profiles:
                    try:
                        res = p.VideoEncoderConfiguration.Resolution
                        enc = p.VideoEncoderConfiguration.Encoding
                        profile_list.append({
                            "name":       p.Name,
                            "token":      p.token,
                            "resolution": f"{res.Width}x{res.Height}",
                            "encoding":   str(enc),
                        })
                    except Exception:
                        profile_list.append({"name": p.Name, "token": p.token})

            # ── PTZ check ───────────────────────────────────────────────
            ptz = "No"
            try:
                cam.create_ptz_service()
                ptz = "Yes"
            except Exception:
                pass

            print(f"[ONVIF] ✅ Successfully connected to {ip}:{attempt_port}")
            return {
                "success":      True,
                "manufacturer": info.Manufacturer,
                "model":        info.Model,
                "firmware":     info.FirmwareVersion,
                "serial":       info.SerialNumber,
                "hardware":     info.HardwareId,
                "stream_uri":   stream_uri,
                "profiles":     profile_list,
                "ptz":          ptz,
                "port":         attempt_port,  # Return the port that worked
            }

        except Exception as e:
            print(f"[ONVIF] ⚠️  Failed to connect to {ip}:{attempt_port}: {str(e)[:100]}")
            continue
    
    # All ports failed
    return {
        "success": False,
        "error":   f"No ONVIF device found on {ip}. Tried ports: {ports_to_try}",
    }

def move_camera_ptz(ip: str, port: int, username: str, password: str,
                    pan: float, tilt: float, zoom: float) -> dict:
    """
    Absolute PTZ move to given pan/tilt/zoom values.
    pan:  -1.0 to 1.0
    tilt: -1.0 to 1.0
    zoom:  0.0 to 1.0
    """
    try:
        cam = ONVIFCamera(ip, port, username, password)
        ptz_service   = cam.create_ptz_service()
        media_service = cam.create_media_service()
        profiles      = media_service.GetProfiles()
        if not profiles:
            return {"success": False, "error": "No profiles found"}

        token = profiles[0].token

        request = ptz_service.create_type("AbsoluteMove")
        request.ProfileToken = token
        request.Position = {
            "PanTilt": {"x": pan, "y": tilt},
            "Zoom":    {"x": zoom},
        }
        request.Speed = {
            "PanTilt": {"x": 0.5, "y": 0.5},
            "Zoom":    {"x": 0.5},
        }
        ptz_service.AbsoluteMove(request)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}
