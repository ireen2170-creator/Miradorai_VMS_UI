"""
ONVIF Device Discovery Service
Auto-detects network subnet and finds real ONVIF cameras
"""

import socket
import re
import subprocess
import ipaddress
import os
from datetime import datetime


def get_local_subnet() -> str:
    """
    Auto-detect the local network subnet by checking active network interfaces.
    For Docker containers, uses HOST_SUBNET environment variable or scans common subnets.
    Returns the subnet (e.g., "192.168.1")
    """
    # Check environment variable first (Docker can override)
    env_subnet = os.environ.get("HOST_SUBNET", "").strip()
    if env_subnet:
        print(f"[DISCOVERY] Using HOST_SUBNET env var: {env_subnet}")
        return env_subnet
    
    # Try Windows ipconfig (since this is Windows host)
    try:
        import platform
        if platform.system() == "Windows":
            result = subprocess.run(
                ["ipconfig"],
                capture_output=True,
                text=True,
                timeout=5
            )
            # Parse for IPv4 addresses (not 127.x, not 172.17-172.18)
            for line in result.stdout.split('\n'):
                if "IPv4 Address" in line:
                    ip = re.search(r'(\d+\.\d+\.\d+\.\d+)', line)
                    if ip:
                        local_ip = ip.group(1)
                        # Skip Docker networks and loopback
                        if not local_ip.startswith(('127.', '172.17.', '172.18.', '169.254.')):
                            parts = local_ip.split('.')
                            subnet = '.'.join(parts[:3])
                            print(f"[DISCOVERY] Detected subnet from ipconfig: {subnet}.x (IP: {local_ip})")
                            return subnet
    except Exception as e:
        print(f"[DISCOVERY] Could not detect subnet from ipconfig: {e}")
    
    # Fallback: try socket (may get Docker IP, but still try)
    try:
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        if not local_ip.startswith(('127.', '172.17.', '172.18.')):
            parts = local_ip.split('.')
            subnet = '.'.join(parts[:3])
            print(f"[DISCOVERY] Detected subnet from socket: {subnet}.x (IP: {local_ip})")
            return subnet
    except Exception as e:
        print(f"[DISCOVERY] Could not detect subnet from socket: {e}")
    
    # Ultimate fallback: scan common home/office subnets
    print(f"[DISCOVERY] Could not auto-detect subnet, will try common subnets")
    return "192.168.1"  # Default fallback


def probe_onvif_device(ip: str, port: int = 80, username: str = "", password: str = "") -> dict | None:
    """
    Probe a device at given IP to get real ONVIF information AND stream URL.
    Returns device info with RTSP stream URI or None if not accessible.
    
    Args:
        ip: Camera IP address
        port: ONVIF service port (default 80)
        username: ONVIF credentials (optional)
        password: ONVIF credentials (optional)
    """
    try:
        from onvif_service import probe_camera
        
        # Try to probe with provided credentials
        result = probe_camera(ip, port, username, password)
        
        if result.get("success"):
            # Extract RTSP URL and clean it
            rtsp_url = result.get('stream_uri', '')
            
            # Clean up RTSP URL (remove ONVIF-specific params)
            import re
            rtsp_url = re.sub(r"[&?]proto=Onvif", "", rtsp_url)
            
            device_info = {
                'id': f"device-{ip}",
                'ip': ip,
                'mac': result.get('serial', 'Unknown'),
                'status': 'online',
                'manufacturer': result.get('manufacturer', 'Unknown'),
                'model': result.get('model', 'Unknown'),
                'firmware': result.get('firmware', ''),
                'rtsp_url': rtsp_url,
                'stream_uri': rtsp_url,
                'discovered_at': datetime.utcnow().isoformat()
            }
            
            print(f"[DISCOVERY] ✓ Probed {ip}: {result.get('manufacturer')} {result.get('model')}")
            if rtsp_url:
                print(f"[DISCOVERY]   RTSP: {rtsp_url}")
            
            return device_info
    except Exception as e:
        print(f"[DISCOVERY] Could not probe {ip}: {e}")
    
    return None


def discover_onvif_devices(timeout: int = 10) -> list:
    """
    Discover ONVIF-compatible devices on the network using WS-Discovery multicast.
    Returns real device information from actual cameras found.
    """
    discovered_devices = {}
    
    try:
        # WS-Discovery probe SOAP message
        probe_message = b"""<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
  <s:Header>
    <a:Action s:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>
    <a:MessageID>urn:uuid:0d52d05f-bfd6-4e77-b8a8-5f22c39f7fcf</a:MessageID>
    <a:ReplyTo>
      <a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address>
    </a:ReplyTo>
    <a:To s:mustUnderstand="1">dn:///</a:To>
  </s:Header>
  <s:Body>
    <d:Probe>
      <d:Types>tdn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </s:Body>
</s:Envelope>"""
        
        # Create UDP socket for multicast
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.settimeout(timeout)
        
        # Multicast address and port for WS-Discovery
        MCAST_GRP = '239.255.255.250'
        MCAST_PORT = 3702
        
        print("[DISCOVERY] Sending WS-Discovery probe to multicast...")
        sock.sendto(probe_message, (MCAST_GRP, MCAST_PORT))
        
        # Receive responses
        try:
            while True:
                data, addr = sock.recvfrom(4096)
                try:
                    xml_data = data.decode('utf-8', errors='ignore')
                    ip = addr[0]
                    
                    # Skip localhost and broadcast addresses
                    if ip.startswith('127.') or ip.startswith('255.'):
                        continue
                    
                    # Extract endpoint URL
                    endpoint_match = re.search(r'<a:Address>(http[^<]+)</a:Address>', xml_data)
                    if endpoint_match:
                        endpoint = endpoint_match.group(1)
                        device_id = f"device-{ip}"
                        
                        if device_id not in discovered_devices:
                            print(f"[DISCOVERY] Found WS-Discovery response from {ip}, probing for details...")
                            
                            # Probe the device to get real information
                            device_info = probe_onvif_device(ip)
                            if device_info:
                                discovered_devices[device_id] = device_info
                                print(f"[DISCOVERY] ✓ {device_info['manufacturer']} {device_info['model']} at {ip}")
                except Exception as e:
                    print(f"[DISCOVERY] Error parsing response: {e}")
                    continue
        except socket.timeout:
            pass
        finally:
            sock.close()
    
    except Exception as e:
        print(f"[DISCOVERY] WS-Discovery error: {e}")
    
    return list(discovered_devices.values())


def discover_onvif_devices_simple(timeout: int = 5, username: str = "", password: str = "") -> list:
    """
    Fallback method: Scan the local subnet for devices with open ONVIF ports.
    Auto-detects local subnet - no hardcoding.
    Probes found devices to get real ONVIF information.
    
    Args:
        timeout: Socket timeout in milliseconds per port
        username: ONVIF credentials (optional)
        password: ONVIF credentials (optional)
    """
    discovered_devices = []
    
    # Auto-detect local subnet
    subnet = get_local_subnet()
    
    # Common ONVIF/video ports
    ports = [80, 8080, 8081, 8888, 554]
    
    print(f"[DISCOVERY] Scanning subnet {subnet}.x for devices on ports {ports}...")
    if username:
        print(f"[DISCOVERY] Using credentials (username: {username})")
    
    scanned_ips = set()
    
    # Scan the subnet
    for i in range(1, 255):
        ip = f"{subnet}.{i}"
        
        if ip in scanned_ips:
            continue
        scanned_ips.add(ip)
        
        for port in ports:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(timeout / 1000.0)  # Convert to seconds
                
                result = sock.connect_ex((ip, port))
                sock.close()
                
                # If connection succeeds, port is open
                if result == 0:
                    print(f"[DISCOVERY] Found open port at {ip}:{port}, probing...")
                    
                    # Try to probe for real ONVIF info with credentials
                    device_info = probe_onvif_device(ip, port, username, password)
                    
                    if device_info:
                        # Only add if we got real info
                        if not any(d['ip'] == ip for d in discovered_devices):
                            discovered_devices.append(device_info)
                            print(f"[DISCOVERY] ✓ Added {device_info['manufacturer']} {device_info['model']} at {ip}")
                    else:
                        # Add as generic device if probe failed but port is open
                        if not any(d['ip'] == ip for d in discovered_devices):
                            discovered_devices.append({
                                'id': f"device-{ip}",
                                'ip': ip,
                                'mac': "Unknown",
                                'status': 'online',
                                'manufacturer': 'Network Device',
                                'model': f"Port {port}",
                                'discovered_at': datetime.utcnow().isoformat()
                            })
                            print(f"[DISCOVERY] ⚠ Added generic device at {ip}:{port}")
                    
                    # Move to next IP once we found a device on this one
                    break
            except Exception:
                pass
    
    return discovered_devices
