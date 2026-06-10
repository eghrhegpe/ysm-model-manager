import struct, sys, os

path = sys.argv[1]
name = os.path.basename(path)
print(f"=== {name} ({os.path.getsize(path)} bytes) ===")

with open(path, 'rb') as f:
    data = f.read()

# Skip BOM + YSGP + CRLF
offset = 3  # BOM
assert data[offset:offset+4] == b'YSGP', f"Not YSGP at byte {offset}"
offset += 4  # skip magic
# Skip CRLF
while offset < len(data) and data[offset:offset+2] in (b'\r\n', b'\n\r'):
    offset += 2

# Find the end of text header (=== marker)
eq_pos = data.find(b'\n===', offset)
if eq_pos > 0:
    header_text = data[offset:eq_pos].decode('utf-8', errors='replace')
    print(f"Header text ({len(header_text)} chars):")
    for line in header_text.split('\n'):
        line = line.strip()
        if line:
            print(f"  {line[:120]}")

    # After ===, skip to binary data
    bin_start = eq_pos + 1  # after \n
    # Skip the === line and any following whitespace
    after_eq = data.find(b'\n', bin_start)
    if after_eq > 0:
        # Check if there's a section header like [ Export ]
        if data[after_eq+1:after_eq+5] == b'----':
            # Another section, find the next ===
            eq2 = data.find(b'\n===', after_eq + 1)
            if eq2 > 0:
                section2 = data[after_eq+1:eq2].decode('utf-8', errors='replace')
                print(f"\nSecond section ({len(section2)} chars):")
                for line in section2.split('\n'):
                    line = line.strip()
                    if line:
                        print(f"  {line[:120]}")
                # Find binary start after this section
                bin_start = data.find(b'\n', eq2 + 1)
                if bin_start > 0:
                    bin_start += 1
        else:
            bin_start = after_eq + 1

    # Skip remaining text sections until we hit binary
    # Binary starts when there are no more --- markers or === markers
    # Actually, YSGP V2 binary is XXTEA encrypted, so we just look for the binary blob

    bin_data = data[bin_start:]
    print(f"\nBinary data: starts at {bin_start}, {len(bin_data)} bytes")

    # Scan for filenames in the binary data
    print("\nSearching for known strings in binary:")
    for s in [b'main.json', b'arm.json', b'texture.png', b'texture2.png', b'ysm.json',
              b'texture.jpg', b'.png', b'.json', b'minecraft:geometry']:
        pos = bin_data.find(s)
        if pos >= 0:
            context = bin_data[max(0,pos-8):pos+len(s)+8]
            print(f"  Found {s!r} at offset {bin_start + pos}")

    # Check if binary is actually readable (not encrypted)
    # If it starts with recognizable patterns
    if bin_data[:4] == b'PK\x03\x04':
        print("\nBinary is a ZIP archive!")
    elif bin_data[:4] == b'YSGP':
        print("\nBinary starts with another YSGP header!")
    elif bin_data[:20].hex() == '00' * 20:
        print(f"\nBinary starts with zeros: {bin_data[:32].hex()}")
    else:
        print(f"\nBinary first 32 bytes: {bin_data[:32].hex()}")
        print(f"Binary first 32 bytes ascii: {bin_data[:32]}")
else:
    print(f"No header end marker found. First 500 bytes: {data[offset:offset+500]}")
