with open("README-the project's development journey.md", 'rb') as f:
    lines = f.readlines()
    for i in range(185, 198):
        print(f'Line {i+1}: {lines[i]!r}')
