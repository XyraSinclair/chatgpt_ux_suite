#!/bin/bash

# ChatGPT UX Suite - Extension Zip Script
# Zips Chrome and Firefox extensions and copies them to treats.sh products folder

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_DEST_DIR="$SCRIPT_DIR/../treats.sh/products"
DEST_DIR="${DEST_DIR:-$DEFAULT_DEST_DIR}"

# Chrome extension
CHROME_DIR="chatgpt_ux_suite_extension"
CHROME_ZIP="chatgpt_ux_suite_extension.zip"

# Firefox extension
FIREFOX_DIR="chatgpt_ux_suite_firefox"
FIREFOX_ZIP="chatgpt_ux_suite_firefox.zip"

cd "$SCRIPT_DIR"

# Function to zip an extension
zip_extension() {
    local dir="$1"
    local zip="$2"
    local name="$3"

    if [ ! -d "$dir" ]; then
        echo "Warning: $name directory $dir does not exist, skipping..."
        return
    fi

    if [ -f "$zip" ]; then
        echo "Removing existing $zip..."
        rm "$zip"
    fi

    echo "Creating $zip..."
    # Zip from inside the directory so files are at root level
    (cd "$dir" && zip -r "../$zip" . -x "*.DS_Store")
}

# Zip both extensions
echo "=== Zipping Chrome Extension ==="
zip_extension "$CHROME_DIR" "$CHROME_ZIP" "Chrome"

echo ""
echo "=== Zipping Firefox Extension ==="
zip_extension "$FIREFOX_DIR" "$FIREFOX_ZIP" "Firefox"

# Copy to destination
echo ""
if [ -d "$DEST_DIR" ]; then
    echo "Copying to $DEST_DIR..."
    [ -f "$CHROME_ZIP" ] && cp "$CHROME_ZIP" "$DEST_DIR/"
    [ -f "$FIREFOX_ZIP" ] && cp "$FIREFOX_ZIP" "$DEST_DIR/"
    echo "Done! Zips copied to $DEST_DIR/"
else
    echo "Warning: Destination directory $DEST_DIR does not exist"
    echo "Zip files created locally at $SCRIPT_DIR/"
fi
