#!/usr/bin/env bash
FILE="$1"
cp "$FILE" "$FILE.bak.$(date +%Y%m%d-%H%M%S)"
echo "[backup] $FILE.bak.* created"
