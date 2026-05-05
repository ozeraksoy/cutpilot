#!/bin/bash
# Cutpilot - macOS install script

set -e

EXTENSION_ID="com.cutpilot.app"
CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
INSTALL_DIR="$CEP_DIR/$EXTENSION_ID"
OLD_TALKY_DIR="$CEP_DIR/com.talky.captioner"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SOURCE_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo ""
echo "==============================================="
echo "       Cutpilot - Premiere Pro Installer       "
echo "==============================================="
echo ""

# 1. Remove old installs
if [ -d "$OLD_TALKY_DIR" ]; then
    echo "-> Removing old Talky installation..."
    rm -rf "$OLD_TALKY_DIR"
fi
if [ -d "$INSTALL_DIR" ]; then
    echo "-> Removing previous Cutpilot installation..."
    rm -rf "$INSTALL_DIR"
fi

# 2. Create CEP folder
echo "-> Preparing CEP extensions folder..."
mkdir -p "$CEP_DIR"
mkdir -p "$INSTALL_DIR"

# 3. Copy plugin files
echo "-> Copying Cutpilot files..."
cp -r "$SOURCE_DIR/CSXS"   "$INSTALL_DIR/"
cp -r "$SOURCE_DIR/client" "$INSTALL_DIR/"
cp -r "$SOURCE_DIR/host"   "$INSTALL_DIR/"

if [ -f "$SOURCE_DIR/.debug" ]; then
    cp "$SOURCE_DIR/.debug" "$INSTALL_DIR/"
fi

echo "   OK Files copied to: $INSTALL_DIR"

# 4. Enable CEP debug mode
echo "-> Enabling CEP debug mode..."
for ver in 9 10 11 12; do
    defaults write "com.adobe.CSXS.$ver" PlayerDebugMode 1 2>/dev/null || true
done
echo "   OK Debug mode enabled."

# 5. FFmpeg check
echo ""
echo "-> Checking for FFmpeg..."

FFMPEG_FOUND=false
for candidate in "ffmpeg" "/opt/homebrew/bin/ffmpeg" "/usr/local/bin/ffmpeg" "/usr/bin/ffmpeg"; do
    if command -v "$candidate" &>/dev/null || [ -f "$candidate" ]; then
        FFMPEG_FOUND=true
        echo "   OK FFmpeg is installed."
        break
    fi
done

if [ "$FFMPEG_FOUND" = false ]; then
    echo ""
    echo "   ! FFmpeg not found. Required for audio extraction."
    echo ""
    read -p "   Install FFmpeg via Homebrew? (y/n): " INSTALL_FFMPEG
    if [ "$INSTALL_FFMPEG" = "y" ] || [ "$INSTALL_FFMPEG" = "Y" ]; then
        if ! command -v brew &>/dev/null && ! [ -f "/opt/homebrew/bin/brew" ]; then
            echo ""
            echo "   Installing Homebrew (this may take a few minutes)..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            if [ -f "/opt/homebrew/bin/brew" ]; then
                eval "$(/opt/homebrew/bin/brew shellenv zsh)"
                echo 'eval "$(/opt/homebrew/bin/brew shellenv zsh)"' >> "$HOME/.zprofile"
            fi
        fi
        echo "   Installing FFmpeg..."
        brew install ffmpeg
        echo "   OK FFmpeg installed."
    else
        echo ""
        echo "   Cutpilot will not work without FFmpeg."
        echo "   To install later: brew install ffmpeg"
        echo ""
    fi
fi

# 6. Done
echo ""
echo "==============================================="
echo "          INSTALLATION COMPLETE                "
echo "==============================================="
echo ""
echo "Next steps:"
echo "  1. Quit Premiere Pro completely (Cmd+Q)"
echo "  2. Reopen Premiere Pro"
echo "  3. Window > Extensions > Cutpilot"
echo "  4. Click the gear icon, paste your OpenAI API key"
echo "     (get one from platform.openai.com/api-keys)"
echo ""
echo "Debug: Chrome > http://localhost:7777"
echo ""
