import struct, sys

path = sys.argv[1]
with open(path, 'rb') as f:
    data = f.read()

magic = data[:4]
ver = struct.unpack('<I', data[4:8])[0]
print(f"Magic: {magic} (hex: {magic.hex()})")
print(f"Version: {ver}")

if magic == b'YSGP':
    print("This is YSGP format (older YSM V2)")
elif magic[:3] == b'YSM':
    print("This is YSM format (V3+)")
    text_end = data.find(b'===', 3)
    if text_end > 0:
        preamble = data[3:text_end+3].decode('utf-8', errors='replace')
        print(f"Preamble text: {preamble}")
elif data[:2] == b'PK':
    print("This is a ZIP file")
else:
    print("Unknown format")

print(f"Bytes 8-16: {data[8:16].hex()}")
print(f"Bytes 16-24: {data[16:24].hex()}")
print(f"Bytes 24-32: {data[24:32].hex()}")

# Search for known strings
for s in [b'ysm.json', b'minecraft:geometry', b'main.json', b'arm.json', b'texture.png', b'animation']:
    pos = data.find(s)
    if pos >= 0:
        print(f"Found {s!r} at byte {pos} (0x{pos:x})")

# Print the first 256 bytes for analysis
print(f"\nFirst 256 bytes hex dump:")
for i in range(0, 256, 16):
    chunk = data[i:i+16]
    hex_str = ' '.join(f'{b:02x}' for b in chunk)
    ascii_str = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in chunk)
    print(f"{i:04x}: {hex_str:48s} {ascii_str}")
