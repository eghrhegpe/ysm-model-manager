import struct, sys, os

def analyze(path):
    name = os.path.basename(path)
    size = os.path.getsize(path)

    with open(path, 'rb') as f:
        data = f.read()

    text = data.decode('utf-8', errors='replace')
    lines = text.split('\n')

    # Extract key info
    info = {
        'name': name,
        'size': size,
        'hash': '',
        'main_model': '',
        'arm_model': '',
        'arrow_model': '',
        'main_texture': '',
        'arrow_texture': '',
        'format': '',
        'crypto': '',
        'bin_offset': -1,
        'texture_files': [],
    }

    for line in lines:
        line = line.strip()
        if line.startswith('<hash>'):
            info['hash'] = line.split('>')[1].strip()
        elif line.startswith('<main-model>'):
            info['main_model'] = line.split('>')[1].strip()
        elif line.startswith('<arm-model>'):
            info['arm_model'] = line.split('>')[1].strip()
        elif line.startswith('<arrow-model>'):
            info['arrow_model'] = line.split('>')[1].strip()
        elif line.startswith('<texture>') and 'arrow' not in line:
            parts = line.split('>', 1)
            if len(parts) > 1:
                rest = parts[1].strip()
                info['main_texture'] = rest.split()[0] if rest else ''
        elif line.startswith('<arrow-texture>'):
            rest = line.split('>', 1)[1].strip()
            info['arrow_texture'] = rest
        elif line.startswith('<format>'):
            info['format'] = line.split('>')[1].strip()
        elif line.startswith('<crypto>'):
            info['crypto'] = line.split('>')[1].strip()

    # Find encoded texture sizes by scanning for PNG signatures within the encrypted data
    # First find where binary data starts
    # Look for the end of text header (line with ----------- after Codec Version)
    for i, line in enumerate(lines):
        if 'Codec Version' in line or 'Codec' in line:
            # Find the closing --- after this section
            for j in range(i, min(i+10, len(lines))):
                if lines[j].startswith('---') and j > i:
                    bin_offset = sum(len(l) + 1 for l in lines[:j+1])
                    info['bin_offset'] = bin_offset
                    break
            break

    return info

models = [
    r'C:\Users\zhujieling11\YSM-Model-Workshop\[苏溟0w0]【自设】\[苏溟0w0]【原创】星咲2025-10.ysm',
    r'C:\Users\zhujieling11\YSM-Model-Workshop\[苏溟0w0]【自设】\[苏溟0w0]【自设】沐白2024-12.ysm',
    r'C:\Users\zhujieling11\YSM-Model-Workshop\[苏溟0w0]【自设】\[苏溟0w0]【自设】苏溟2024-10.ysm',
]

print(f"{'模型':<30} {'大小':<8} {'Hash(前8)':<10} {'Format':<6} {'Crypto':<6} {'主纹理':<20} {'箭纹理':<20}")
print("-"*110)
for p in models:
    info = analyze(p)
    print(f"{info['name']:<30} {info['size']:<8} {info['hash'][:8]:<10} {info['format']:<6} {info['crypto']:<6} {info['main_texture'][:20]:<20} {info['arrow_texture'][:20]:<20}")
