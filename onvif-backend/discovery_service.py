import socket
import uuid

def discover_onvif_devices(timeout=3):
    message = f"""<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
 xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
  <e:Header>
    <w:MessageID>uuid:{uuid.uuid4()}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe/>
  </e:Body>
</e:Envelope>"""

    multicast_group = ("239.255.255.250", 3702)

    # ✅ Create UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)

    # ✅ Allow reuse
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    # ✅ Set multicast TTL
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)

    # ✅ Bind to listen responses
    sock.bind(("", 0))

    sock.settimeout(timeout)

    # ✅ Send probe
    sock.sendto(message.encode("utf-8"), multicast_group)

    devices = []

    try:
        while True:
            data, addr = sock.recvfrom(4096)
            devices.append(data.decode("utf-8"))
    except socket.timeout:
        pass

    sock.close()
    return devices