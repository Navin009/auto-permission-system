#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "  Auto Permission System — Interactive Demo Runner        "
echo "=========================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run terminal simulation
python3 "${SCRIPT_DIR}/simulate-session.py"

echo ""
echo "To re-generate MP4 and GIF recordings:"
echo "  python3 ${SCRIPT_DIR}/generate-recording.py"
echo ""
echo "Demo artifacts generated in:"
echo "  - assets/demo.mp4"
echo "  - assets/demo.gif"
