import struct, sys

path = sys.argv[1]
with open(path, 'rb') as f:
    data = f.read()

print(f"File size: {len(data)} bytes")
print(f"First 16 bytes hex: {data[:16].hex()}")
print(f"Starts with YSM: {data[:3] == b'YSM'}")

if data[:3] == b'YSM':
    # Find preamble end (null byte)
    null_pos = data.find(b'\x00', 3)
    if null_pos > 3:
        preamble = data[3:null_pos].decode('utf-8', errors='replace')
        print(f"Preamble: {preamble}")
        # Check for JSON-like content after preamble
        after_preamble = data[null_pos:null_pos+200]
        print(f"After preamble (200 bytes): {after_preamble[:200]}")
        print(f"After preamble hex: {after_preamble[:50].hex()}")
else:
    # Maybe it's a different encrypted format
    print("Not YSM magic - checking first bytes:")
    print(f"Bytes 0-3: {data[:3]}")
    # Check if it's a ZIP (PK) disguised as .ysm
    if data[:2] == b'PK':
        print("This looks like a ZIP file with .ysm extension!")
    # Check if it looks like raw data
    print(f"Is mostly printable: {sum(1 for b in data[:200] if 32 <= b <= 126) > 150}")
