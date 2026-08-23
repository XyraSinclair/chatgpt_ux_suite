#!/bin/bash

# ChatGPT UX Suite - Extension Zip Script
# Zips the Chrome and Firefox extensions for store upload.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
