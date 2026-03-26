import requests
import base64
import os

<<<<<<< HEAD
OME_URL = "http://ome:8081/v1/vhosts/default/apps/app/streams"
OME_HOST = os.environ.get("OME_HOST_IP", "192.168.126.100")
OME_PORT = os.environ.get("OME_PORT", "3333")
WS_BASE  = f"ws://{OME_HOST}:{OME_PORT}/app"
=======
OME_URL = os.environ.get("OME_URL", "http://ome:8081/v1/vhosts/default/apps/app/streams")

token = base64.b64encode("bXl2bXNhY2Nlc3N0b2tlbg==".encode()).decode()
>>>>>>> 78912786884fc3d26ad130e4c125a00250d76595

headers = {
    "Content-Type": "application/json",
    "Authorization": "Basic bXl2bXNhY2Nlc3N0b2tlbg=="

}

def get_ws_url(stream_name: str) -> str:
    return f"{WS_BASE}/{stream_name}"

def register_stream(stream_name, rtsp_url):
    payload = {
        "name": stream_name,
        "urls": [rtsp_url],
        "persistent": True,
        "noInputFailoverTimeoutMs": -1,
        "unusedStreamDeletionTimeoutMs": -1
    }
    try:
        res = requests.post(OME_URL, json=payload, headers=headers, timeout=10)
        print("OME STATUS:", res.status_code)
        print("OME RESPONSE:", res.text)
        return res.json()
    except Exception as e:
        return {"error": str(e)}