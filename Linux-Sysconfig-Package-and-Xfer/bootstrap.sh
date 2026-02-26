#!/usr/bin/env bash
###############################################################################
# bootstrap.sh — Single-command new machine setup
#
# This is the ONLY thing you need to run on a fresh Debian/Ubuntu install.
# It installs rclone, downloads your backup from Google Drive, and runs
# the full restore automatically.
#
# Usage (from fresh install):
#   curl -fsSL https://raw.githubusercontent.com/jdgafx/Linux-Sysconfig-Package-and-Xfer/main/bootstrap.sh | bash
#
# Or if you have the file:
#   bash bootstrap.sh
#
# Or with a local backup file:
#   bash bootstrap.sh /path/to/linux-sysconfig-*.tar.zst
###############################################################################
set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; }
hdr()  { echo -e "\n${CYAN}${BOLD}=== $* ===${NC}"; }

GDRIVE_FOLDER="Linux-Sysconfig-Backups"
WORK_DIR="/tmp/sysconfig-bootstrap-$$"
LOCAL_BACKUP="${1:-}"

cat <<'BANNER'

  ╔══════════════════════════════════════════════════╗
  ║   Linux Sysconfig Transfer — Bootstrap v1.0     ║
  ║   Automated Dev Environment Setup               ║
  ╚══════════════════════════════════════════════════╝

BANNER

# --- Step 0: Get sudo --------------------------------------------------------
hdr "Checking Permissions"
if [ "$(id -u)" -eq 0 ]; then
    log "Running as root"
    SUDO=""
else
    SUDO="sudo"
    log "Checking sudo access..."
    if ! $SUDO -v 2>/dev/null; then
        err "sudo access required. Please run with sudo or enter your password."
        exit 1
    fi
    log "sudo access confirmed"
fi

# --- Step 1: Install minimal dependencies ------------------------------------
hdr "Installing Bootstrap Dependencies"
$SUDO apt-get update -qq 2>/dev/null || true
$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y \
    curl wget git zstd ca-certificates gnupg 2>/dev/null || {
    err "Failed to install basic dependencies"
    exit 1
}
log "Base dependencies ready"

# --- Step 2: Install rclone --------------------------------------------------
hdr "Setting Up Rclone"
if ! command -v rclone &>/dev/null; then
    log "Installing rclone..."
    curl -fsSL https://rclone.org/install.sh | $SUDO bash || {
        err "rclone installation failed"
        exit 1
    }
fi
log "rclone $(rclone version --check 2>/dev/null | head -1 || echo 'installed')"

# --- Step 3: Configure Google Drive remote ------------------------------------
if [ -z "$LOCAL_BACKUP" ]; then
    hdr "Configuring Google Drive Access"

    if ! rclone listremotes 2>/dev/null | grep -q "gdrive:"; then
        echo ""
        echo -e "${BOLD}rclone needs to authenticate with Google Drive.${NC}"
        echo -e "This will open a browser window for OAuth login."
        echo -e "If you're on a headless machine, use: ${CYAN}rclone config${NC}"
        echo ""

        # Auto-configure gdrive remote
        rclone config create gdrive drive || {
            echo ""
            warn "Auto-config failed. Running interactive setup..."
            echo -e "${YELLOW}Choose: New remote -> name: gdrive -> type: drive -> follow prompts${NC}"
            rclone config
        }
    fi

    # Verify access
    if ! rclone lsd gdrive: &>/dev/null 2>&1; then
        err "Cannot access Google Drive. Please run: rclone config reconnect gdrive:"
        exit 1
    fi
    ok "Google Drive connected"

    # --- Step 4: Find and download latest backup ------------------------------
    hdr "Finding Latest Backup"
    log "Searching gdrive:${GDRIVE_FOLDER}/..."

    LATEST=$(rclone lsf "gdrive:${GDRIVE_FOLDER}/" --files-only 2>/dev/null | \
        grep "linux-sysconfig-.*\.tar\.zst" | sort -r | head -1)

    if [ -z "$LATEST" ]; then
        err "No backup found in gdrive:${GDRIVE_FOLDER}/"
        echo -e "Available files:"
        rclone ls "gdrive:${GDRIVE_FOLDER}/" 2>/dev/null || echo "  (empty or folder doesn't exist)"
        echo ""
        echo -e "If you have a local backup, run: ${CYAN}bash bootstrap.sh /path/to/backup.tar.zst${NC}"
        exit 1
    fi

    log "Found: ${LATEST}"
    mkdir -p "$WORK_DIR"

    log "Downloading..."
    rclone copy "gdrive:${GDRIVE_FOLDER}/${LATEST}" "$WORK_DIR" --progress --transfers=8 || {
        err "Download failed"
        exit 1
    }
    BACKUP_FILE="$WORK_DIR/$LATEST"
    ok "Downloaded: $(du -h "$BACKUP_FILE" | cut -f1)"

    # Also download restore.sh from Drive if available
    rclone copy "gdrive:${GDRIVE_FOLDER}/restore.sh" "$WORK_DIR" 2>/dev/null || true
else
    BACKUP_FILE="$LOCAL_BACKUP"
    if [ ! -f "$BACKUP_FILE" ]; then
        err "Backup file not found: $BACKUP_FILE"
        exit 1
    fi
    log "Using local backup: $BACKUP_FILE"
fi

# --- Step 5: Get restore.sh --------------------------------------------------
hdr "Getting Restore Script"
RESTORE_SCRIPT=""

# Check if downloaded from Drive
if [ -f "$WORK_DIR/restore.sh" ]; then
    RESTORE_SCRIPT="$WORK_DIR/restore.sh"
    log "Using restore.sh from Google Drive"
fi

# Try to get from GitHub
if [ -z "$RESTORE_SCRIPT" ]; then
    log "Downloading restore.sh from GitHub..."
    curl -fsSL "https://raw.githubusercontent.com/jdgafx/Linux-Sysconfig-Package-and-Xfer/main/restore.sh" \
        -o "$WORK_DIR/restore.sh" 2>/dev/null && RESTORE_SCRIPT="$WORK_DIR/restore.sh"
fi

# Extract from backup as last resort
if [ -z "$RESTORE_SCRIPT" ]; then
    warn "Extracting restore.sh from backup..."
    tar -I zstd -xf "$BACKUP_FILE" -C "$WORK_DIR" --wildcards "*/restore.sh" 2>/dev/null || true
    RESTORE_SCRIPT=$(find "$WORK_DIR" -name "restore.sh" -type f | head -1)
fi

if [ -z "$RESTORE_SCRIPT" ] || [ ! -f "$RESTORE_SCRIPT" ]; then
    err "Could not find restore.sh anywhere!"
    echo "Please download it manually from: https://github.com/jdgafx/Linux-Sysconfig-Package-and-Xfer"
    exit 1
fi

chmod +x "$RESTORE_SCRIPT"
ok "restore.sh ready"

# --- Step 6: Run the full restore ---------------------------------------------
hdr "Launching Full Restore"
echo ""
echo -e "${BOLD}This will install all packages, dev tools, and configs.${NC}"
echo -e "${BOLD}It runs as root (sudo) and will take 10-30 minutes.${NC}"
echo ""

# If we're already root, just run it; otherwise use sudo
if [ "$(id -u)" -eq 0 ]; then
    bash "$RESTORE_SCRIPT" "$BACKUP_FILE"
else
    $SUDO bash "$RESTORE_SCRIPT" "$BACKUP_FILE"
fi

EXIT_CODE=$?

# --- Cleanup ------------------------------------------------------------------
rm -rf "$WORK_DIR"

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo -e "${GREEN}${BOLD}Bootstrap complete! Log out and back in to activate everything.${NC}"
else
    echo ""
    warn "Restore finished with exit code ${EXIT_CODE}. Check the log for details."
fi

exit $EXIT_CODE
