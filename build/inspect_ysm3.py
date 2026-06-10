import struct, sys, base64, os

path = sys.argv[1]
name = os.path.basename(path)
print(f"=== {name} ({os.path.getsize(path)} bytes) ===")

with open(path, 'rb') as f:
    data = f.read()

# Check BOM
if data[:3] == b'\xef\xbb\xbf':
    print("Has UTF-8 BOM")
    offset = 3
else:
    offset = 0

magic = data[offset:offset+4]
print(f"Magic at byte {offset}: {magic}")

if magic == b'YSGP':
    # After magic, check for text header
    rest = data[offset+4:]
    # Look for the end of text header (marked by === or binary start)
    header_end = rest.find(b'\n===')
    if header_end > 0:
        header_text = rest[:header_end].decode('utf-8', errors='replace')
        print(f"Text header ({header_end} bytes):")
        print(header_text[:500])
        print("...")

        # After header, find binary start
        # The header ends with ===\n or similar
        bin_start = offset + 4 + header_end
        # Find the === line
        eq_line = rest.find(b'===', header_end - 20)
        if eq_line >= 0:
            eq_end = rest.find(b'\n', eq_line)
            if eq_end > 0:
                bin_start = offset + 4 + eq_end + 1
        print(f"Binary data starts at byte {bin_start}")
        print(f"Binary size: {len(data) - bin_start} bytes")

        # Try to find known strings in the binary section
        bin_data = data[bin_start:]
        for s in [b'main.json', b'arm.json', b'texture.png', b'texture2.png', b'ysm.json',
                  b'minecraft:geometry', b'animation', b'.png', b'.json']:
            pos = bin_data.find(s)
            if pos >= 0:
                print(f"Found {s!r} in binary at offset {bin_start + pos} (relative {pos})")
    else:
        print(f"No header end marker found, first 500 bytes: {rest[:500]}")
elif magic[:3] == b'YSM':
    print("Standard YSM V3 format")
else:
    print(f"Unknown magic: {magic}")
    print(f"Bytes 0-30 hex: {data[:30].hex()}")
