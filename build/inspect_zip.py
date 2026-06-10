import zipfile, json, sys
path = sys.argv[1]
z = zipfile.ZipFile(path)
print(f"=== ZIP: {path} ===")
print(f"Total files: {len(z.namelist())}")
for n in z.namelist():
    print(f"  {n} ({len(z.read(n))}B)")
print()
for n in z.namelist():
    if n.endswith('.json'):
        data = z.read(n)
        j = json.loads(data)
        print(f"=== {n} ({len(data)}B) ===")
        print(f"  Keys: {list(j.keys())}")
        print(f"  format_version: {j.get('format_version')}")
        geo = j.get('minecraft:geometry')
        if geo:
            print(f"  geometry: type={type(geo).__name__}, len={len(geo)}")
            if len(geo) > 0:
                desc = geo[0].get('description', {})
                print(f"  texture_width: {desc.get('texture_width')}, texture_height: {desc.get('texture_height')}")
                bones = geo[0].get('bones', [])
                print(f"  bones count: {len(bones)}")
                if bones:
                    print(f"  first bone: {bones[0].get('name')}, cubes: {len(bones[0].get('cubes', []))}")
        else:
            print("  NO minecraft:geometry key!")
            # Check if it has animation
            if 'animations' in j:
                print(f"  Has animations: {len(j.get('animations', {}))}")
z.close()
