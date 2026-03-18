"""
ONVIF Device Discovery Service
Uses WS-Discovery and subnet scanning to find cameras on the network
"""

import socket
import re
from datetime import datetime


def discover_onvif_devices(timeout: int = 10) -> list:
    """
    Discover ONVIF-compatible devices on the network using WS-Discovery.
    
    Args:
        timeout: Socket timeout in seconds
    
    Returns:
        List of discovered devices with IP, MAC, manufacturer, model, status
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
        
        # Send probe message
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
                        
                        # Extract MAC if present
                        mac_match = re.search(r'/([0-9A-Fa-f]{2}(?:[0-9A-Fa-f]{2}){5})', endpoint)
                        mac = mac_match.group(1).upper() if mac_match else "Unknown"
                        
                        # Create unique device entry
                        device_id = f"device-{ip}"
                        
                        if device_id not in discovered_devices:
                            discovered_devices[device_id] = {
                                'id': device_id,
                                'ip': ip,
                                'mac': mac,
                                'status': 'online',
                                'manufacturer': 'ONVIF Device',
                                'model': 'Unknown',
                                'discovered_at': datetime.utcnow().isoformat()
                            }
                            print(f"[DISCOVERY] Found ONVIF device at {ip}")
                except Exception as e:
                    print(f"[DISCOVERY] Error parsing response: {e}")
                    continue
        except socket.timeout:
            pass
        finally:
            sock.close()
    
    except Exception as e:
        print(f"[DISCOVERY] WS-Discovery error: {e}")
        return []
    
    return list(discovered_devices.values())


def discover_onvif_devices_simple(timeout: int = 5, subnet: str = "192.168.1") -> list:
    """
    Simple ONVIF discovery by scanning common ports in a subnet.
    Fallback method if WS-Discovery doesn't work.
    
    Args:
        timeout: Socket timeout in milliseconds per port
        subnet: Subnet to scan (e.g., "192.168.1")
    
    Returns:
        List of devices found by checking common ONVIF ports
    """
    discovered_devices = []
    
    # Common ONVIF/video ports
    ports = [80, 8080, 8081, 8888, 554]
    
    # Scan the subnet
    for i in range(1, 255):
        ip = f"{subnet}.{i}"
        
        for port in ports:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(timeout / 1000.0)  # Convert to seconds
                
                result = sock.connect_ex((ip, port))
                sock.close()
                
                # If connection succeeds, port is open
                if result == 0:
                    # Check if we already added this IP
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
                        print(f"[DISCOVERY] Found device at {ip}:{port}")
            except Exception:
                pass
    
    return discovered_devices
