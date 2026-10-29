#!/bin/zsh
# Install (or update) the usage feed on this Mac: copies push_usage.py out of the repo, creates the
# secret gist on the first run, and loads a LaunchAgent that runs the script every 5 minutes.
# Safe to run again after changing push_usage.py. Uninstall: ./install.sh --uninstall
set -euo pipefail

HOME_DIR="$HOME/Library/Application Support/GrindUsage"
LABEL="com.scattabrain.grind-usage"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
GH=/opt/homebrew/bin/gh
HERE="${0:A:h}"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Stopped. The gist and $HOME_DIR were left in place."
  exit 0
fi

mkdir -p "$HOME_DIR"
cp "$HERE/push_usage.py" "$HOME_DIR/push_usage.py"

if [[ ! -f "$HOME_DIR/config.json" ]]; then
  echo '{"v":1,"providers":[],"history":[]}' > "$HOME_DIR/usage.json"
  url=$("$GH" gist create --desc "The Grind: CodexBar usage feed" "$HOME_DIR/usage.json")
  rm "$HOME_DIR/usage.json"
  echo "{\"gist_id\": \"${url##*/}\"}" > "$HOME_DIR/config.json"
  echo "Created gist $url"
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/python3</string><string>$HOME_DIR/push_usage.py</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME_DIR/feed.log</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/feed.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Running every 5 minutes. Log: $HOME_DIR/feed.log"
echo "Gist id (the Dashboard page reads it): $(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["gist_id"])' "$HOME_DIR/config.json")"
