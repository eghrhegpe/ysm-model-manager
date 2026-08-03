import sys, os

path = sys.argv[1]
name = os.path.basename(path)
print(f"=== {name} ({os.path.getsize(path)} bytes) ===")

with open(path, 'rb') as f:
    # Read first 20KB to find the header
    data = f.read(20000)

# Check BOM + YSGP
if data[:3] == b'\xef\xbb\xbf':
    print("Has UTF-8 BOM")
    offset = 3
    if data[offset:offset+4] == b'YSGP':
        print("YSGP magic found after BOM")
        offset += 4
        # Skip CRLF
        while offset < len(data) and data[offset:offset+2] in (b'\r\n', b'\n\r'):
            offset += 2

        # Find the end of text header
        # Look for the last === before binary data
        # The header sections are: Metadata, Tips, Export, Codec
        # Each section starts with --- and ends with ===

        # Find all === positions
        eq_positions = []
        pos = 0
        while True:
            pos = data.find(b'===', pos)
            if pos < 0 or pos > 10000:
                break
            eq_positions.append(pos)
            pos += 1

        print(f"\nFound {len(eq_positions)} '===' markers in first 10KB:")
        for p in eq_positions:
            line_start = data.rfind(b'\n', 0, p)
            if line_start < 0:
                line_start = max(0, p - 40)
            line_end = data.find(b'\n', p)
            if line_end < 0:
                line_end = min(len(data), p + 40)
            line = data[line_start:line_end].decode('utf-8', errors='replace')
            print(f"  {p}: {line.strip()[:100]}")

        # Find the last === before binary (the Codec section)
        # After the last ===, there should be binary data
        if eq_positions:
            last_eq = eq_positions[-1]
            # After last ===, skip to binary
            # The binary starts after the === line
            line_end = data.find(b'\n', last_eq)
            if line_end > 0:
                bin_start = line_end + 1
                print(f"\nBinary starts at offset {bin_start}")

                # Read the actual binary from the file
                with open(path, 'rb') as f2:
                    f2.seek(bin_start)
                    bin_data = f2.read(500)

                print(f"Binary first 100 bytes hex: {bin_data[:100].hex()}")
                print(f"Binary first 100 bytes: {bin_data[:100]}")

                # Check if binary is encrypted (looks random)
                entropy = sum(bin_data.count(b) for b in set(bin_data[:100]))
                print(f"Unique bytes in first 100: {entropy}")

                # Search for file names
                with open(path, 'rb') as f2:
                    full_data = f2.read()
                for s in [b'main.json', b'arm.json', b'texture.png', b'texture2.png',
                          b'left_arm.json', b'right_arm.json', b'arrow.json']:
                    if s in full_data:
                        print(f"Found {s!r} at offset {full_data.index(s)}")
else:
    print("No BOM, checking raw magic...")
    if data[:4] == b'YSGP':
        print("YSGP at byte 0")
    elif data[:3] == b'YSM':
        print("YSM at byte 0")
    else:
        print(f"Unknown: {data[:10].hex()}")
