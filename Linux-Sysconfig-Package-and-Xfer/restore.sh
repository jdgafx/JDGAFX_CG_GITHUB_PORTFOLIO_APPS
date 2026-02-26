#!/usr/bin/env bash
###############################################################################
# restore.sh — Fully automated dev environment restoration
#
# Restores everything captured by capture.sh onto a fresh Debian/Ubuntu install.
# Designed for resilience: every step is idempotent, failures are logged but
# never block subsequent steps.
#
# Usage:  sudo bash restore.sh /path/to/linux-sysconfig-*.tar.zst
#         sudo bash restore.sh   (auto-finds latest backup in current dir)
###############################################################################
set -uo pipefail
IFS=$'\n\t'

# --- Colors & Logging --------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

LOGFILE="/tmp/sysconfig-restore-$(date +%Y%m%d-%H%M%S).log"

log()  { echo -e "${GREEN}[+]${NC} $*" | tee -a "$LOGFILE"; }
warn() { echo -e "${YELLOW}[!]${NC} $*" | tee -a "$LOGFILE"; }
err()  { echo -e "${RED}[x]${NC} $*" | tee -a "$LOGFILE"; }
hdr()  { echo -e "\n${CYAN}${BOLD}=== $* ===${NC}" | tee -a "$LOGFILE"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*" | tee -a "$LOGFILE"; }
fail() { echo -e "${RED}[FAIL]${NC} $*" | tee -a "$LOGFILE"; }

FAILED_STEPS=()
track_failure() {
    FAILED_STEPS+=("$1")
    fail "$1 — logged, continuing..."
}

# --- Detect target user (we run as root but install for the real user) --------
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}This script must be run as root (sudo).${NC}"
    echo "Usage: sudo bash restore.sh [/path/to/backup.tar.zst]"
    exit 1
fi

# Determine the real user (the one who called sudo)
TARGET_USER="${SUDO_USER:-$(logname 2>/dev/null || echo chris)}"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
[ -z "$TARGET_HOME" ] && TARGET_HOME="/home/${TARGET_USER}"

log "Restoring for user: ${TARGET_USER} (home: ${TARGET_HOME})"
log "Log file: ${LOGFILE}"

# --- Helper: run as target user -----------------------------------------------
as_user() {
    su - "$TARGET_USER" -c "$*"
}

# --- Helper: resilient apt install (batch with retry) -------------------------
apt_install_resilient() {
    local pkg_file="$1"
    local label="$2"
    local total=$(wc -l < "$pkg_file")
    local installed=0
    local failed_pkgs=()

    hdr "Installing ${label} (${total} packages)"

    # First pass: bulk install in batches of 50
    local batch=()
    local batch_num=0
    while IFS= read -r pkg; do
        # Strip arch suffix for cleaner install
        pkg="${pkg%%:*}"
        [ -z "$pkg" ] && continue
        batch+=("$pkg")

        if [ ${#batch[@]} -ge 50 ]; then
            batch_num=$((batch_num + 1))
            log "  Batch ${batch_num} (${#batch[@]} packages)..."
            if DEBIAN_FRONTEND=noninteractive apt-get install -y \
                -o Dpkg::Options::="--force-confdef" \
                -o Dpkg::Options::="--force-confold" \
                --no-install-recommends \
                "${batch[@]}" >>"$LOGFILE" 2>&1; then
                installed=$((installed + ${#batch[@]}))
            else
                # Batch failed — try individually
                for p in "${batch[@]}"; do
                    if DEBIAN_FRONTEND=noninteractive apt-get install -y \
                        -o Dpkg::Options::="--force-confdef" \
                        -o Dpkg::Options::="--force-confold" \
                        "$p" >>"$LOGFILE" 2>&1; then
                        installed=$((installed + 1))
                    else
                        failed_pkgs+=("$p")
                    fi
                done
            fi
            batch=()
        fi
    done < "$pkg_file"

    # Final partial batch
    if [ ${#batch[@]} -gt 0 ]; then
        batch_num=$((batch_num + 1))
        log "  Batch ${batch_num} (${#batch[@]} packages)..."
        if DEBIAN_FRONTEND=noninteractive apt-get install -y \
            -o Dpkg::Options::="--force-confdef" \
            -o Dpkg::Options::="--force-confold" \
            --no-install-recommends \
            "${batch[@]}" >>"$LOGFILE" 2>&1; then
            installed=$((installed + ${#batch[@]}))
        else
            for p in "${batch[@]}"; do
                if DEBIAN_FRONTEND=noninteractive apt-get install -y \
                    -o Dpkg::Options::="--force-confdef" \
                    -o Dpkg::Options::="--force-confold" \
                    "$p" >>"$LOGFILE" 2>&1; then
                    installed=$((installed + 1))
                else
                    failed_pkgs+=("$p")
                fi
            done
        fi
    fi

    ok "${installed}/${total} packages installed"
    if [ ${#failed_pkgs[@]} -gt 0 ]; then
        warn "${#failed_pkgs[@]} packages failed:"
        printf '  %s\n' "${failed_pkgs[@]}" | tee -a "$LOGFILE"
        printf '%s\n' "${failed_pkgs[@]}" > "/tmp/failed-${label// /-}.txt"
    fi
}

# --- Locate & Extract Backup -------------------------------------------------
hdr "Locating Backup Archive"

TARBALL="${1:-}"
if [ -z "$TARBALL" ]; then
    # Auto-find latest backup
    TARBALL=$(find . /tmp "$TARGET_HOME" -maxdepth 2 -name "linux-sysconfig-*.tar.zst" -type f 2>/dev/null | sort -r | head -1)
fi

if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then
    err "No backup archive found."
    echo "Usage: sudo bash restore.sh /path/to/linux-sysconfig-*.tar.zst"
    exit 1
fi

log "Using backup: ${TARBALL}"

EXTRACT_DIR="/tmp/sysconfig-restore-$$"
mkdir -p "$EXTRACT_DIR"
log "Extracting..."

if command -v zstd &>/dev/null; then
    tar -I zstd -xf "$TARBALL" -C "$EXTRACT_DIR" 2>>"$LOGFILE"
else
    # Install zstd first
    apt-get update -qq && apt-get install -y zstd >>"$LOGFILE" 2>&1
    tar -I zstd -xf "$TARBALL" -C "$EXTRACT_DIR" 2>>"$LOGFILE"
fi

# Find the actual backup directory inside the extract
BACKUP_DIR=$(find "$EXTRACT_DIR" -maxdepth 1 -type d -name "linux-sysconfig-*" | head -1)
[ -z "$BACKUP_DIR" ] && BACKUP_DIR="$EXTRACT_DIR"

log "Backup contents at: ${BACKUP_DIR}"
ls "$BACKUP_DIR"/ 2>/dev/null | tee -a "$LOGFILE"

# =============================================================================
#  PHASE 1: Base System (requires network)
# =============================================================================
hdr "PHASE 1: System Packages & Repos"

# --- 1a. Essential tools first ------------------------------------------------
log "Installing essential tools..."
apt-get update -qq 2>>"$LOGFILE" || true
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    curl wget git build-essential software-properties-common \
    apt-transport-https ca-certificates gnupg lsb-release \
    zstd jq python3 python3-pip python3-venv \
    >>"$LOGFILE" 2>&1 || track_failure "essential-tools"

# --- 1b. Restore APT keyrings ------------------------------------------------
hdr "Restoring APT Keyrings"
if [ -d "$BACKUP_DIR/keyrings" ]; then
    mkdir -p /usr/share/keyrings /etc/apt/keyrings
    cp -n "$BACKUP_DIR/keyrings/"*.gpg /usr/share/keyrings/ 2>/dev/null || true
    cp -n "$BACKUP_DIR/keyrings/"*.gpg /etc/apt/keyrings/ 2>/dev/null || true
    ok "Keyrings restored"
fi

# --- 1c. Restore APT sources -------------------------------------------------
hdr "Restoring APT Sources"
if [ -d "$BACKUP_DIR/apt-sources" ]; then
    # Restore sources.list
    [ -f "$BACKUP_DIR/apt-sources/sources.list" ] && \
        cp "$BACKUP_DIR/apt-sources/sources.list" /etc/apt/sources.list

    # Restore sources.list.d entries (skip ubuntu.sources — will be auto-generated)
    for f in "$BACKUP_DIR/apt-sources/"*; do
        fname=$(basename "$f")
        [ "$fname" = "sources.list" ] && continue
        [ "$fname" = "ubuntu.sources" ] && continue
        cp "$f" "/etc/apt/sources.list.d/$fname" 2>/dev/null || true
        log "  Restored: $fname"
    done

    # Fix for Debian vs Ubuntu: adjust suite names if needed
    DISTRO_CODENAME=$(lsb_release -cs 2>/dev/null || echo "bookworm")
    log "  Target distro codename: ${DISTRO_CODENAME}"

    # Update repos (allow failures for repos that may not exist on new distro)
    apt-get update -qq 2>>"$LOGFILE" || warn "Some repos failed to update (expected on new distro)"
fi

# --- 1d. Install APT packages ------------------------------------------------
if [ -f "$BACKUP_DIR/manifests/apt-manual.txt" ]; then
    apt_install_resilient "$BACKUP_DIR/manifests/apt-manual.txt" "APT manually-installed"
else
    warn "No apt-manual.txt found, using full package list"
    [ -f "$BACKUP_DIR/manifests/apt-packages.txt" ] && \
        apt_install_resilient "$BACKUP_DIR/manifests/apt-packages.txt" "APT all packages"
fi

# --- 1e. Snap packages -------------------------------------------------------
hdr "Snap Packages"
if command -v snap &>/dev/null && [ -f "$BACKUP_DIR/manifests/snap-packages.txt" ]; then
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        pkg=$(echo "$line" | awk '{print $1}')
        flag=$(echo "$line" | awk '{print $2}')
        # Skip base/core snaps — they install automatically
        case "$pkg" in bare|core*|snapd|gnome-*|gtk-*|icon-*|kf5-*|mesa-*|ffmpeg-*) continue ;; esac
        log "  Installing snap: ${pkg} ${flag}"
        snap install "$pkg" $flag >>"$LOGFILE" 2>&1 || track_failure "snap:${pkg}"
    done < "$BACKUP_DIR/manifests/snap-packages.txt"
    ok "Snap packages processed"
else
    warn "snap not available or no manifest"
fi

# --- 1f. Flatpak packages ----------------------------------------------------
hdr "Flatpak Packages"
if [ -f "$BACKUP_DIR/manifests/flatpak-packages.txt" ] && [ -s "$BACKUP_DIR/manifests/flatpak-packages.txt" ]; then
    command -v flatpak &>/dev/null || apt-get install -y flatpak >>"$LOGFILE" 2>&1
    flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo 2>/dev/null || true
    while IFS= read -r app_id; do
        [ -z "$app_id" ] && continue
        flatpak install -y flathub "$app_id" >>"$LOGFILE" 2>&1 || track_failure "flatpak:${app_id}"
    done < "$BACKUP_DIR/manifests/flatpak-packages.txt"
fi

# =============================================================================
#  PHASE 2: Dev Toolchains (as user, not root)
# =============================================================================
hdr "PHASE 2: Dev Toolchains"

# --- 2a. NVM + Node ----------------------------------------------------------
hdr "NVM & Node.js"
if [ -f "$BACKUP_DIR/manifests/nvm-versions.txt" ]; then
    as_user 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash' \
        >>"$LOGFILE" 2>&1 || track_failure "nvm-install"

    # Install each Node version
    while IFS= read -r ver; do
        [ -z "$ver" ] && continue
        log "  Installing Node ${ver}..."
        as_user "export NVM_DIR=\$HOME/.nvm && . \$NVM_DIR/nvm.sh && nvm install ${ver}" \
            >>"$LOGFILE" 2>&1 || track_failure "node:${ver}"
    done < "$BACKUP_DIR/manifests/nvm-versions.txt"

    # Set default
    if [ -f "$BACKUP_DIR/manifests/nvm-default.txt" ]; then
        DEFAULT_NODE=$(cat "$BACKUP_DIR/manifests/nvm-default.txt")
        as_user "export NVM_DIR=\$HOME/.nvm && . \$NVM_DIR/nvm.sh && nvm alias default ${DEFAULT_NODE}" \
            >>"$LOGFILE" 2>&1 || true
        ok "Node default set to ${DEFAULT_NODE}"
    fi
fi

# --- 2b. Bun ------------------------------------------------------------------
hdr "Bun"
if [ -f "$BACKUP_DIR/manifests/bun-version.txt" ]; then
    as_user 'curl -fsSL https://bun.sh/install | bash' >>"$LOGFILE" 2>&1 || track_failure "bun-install"
    ok "Bun installed"
fi

# --- 2c. NPM Global Packages -------------------------------------------------
hdr "NPM Global Packages"
if [ -f "$BACKUP_DIR/manifests/npm-globals.txt" ] && [ -s "$BACKUP_DIR/manifests/npm-globals.txt" ]; then
    NPKG_LIST=$(cat "$BACKUP_DIR/manifests/npm-globals.txt" | tr '\n' ' ')
    log "  Installing: ${NPKG_LIST}"
    as_user "export NVM_DIR=\$HOME/.nvm && . \$NVM_DIR/nvm.sh && npm install -g ${NPKG_LIST}" \
        >>"$LOGFILE" 2>&1 || {
        # Retry one at a time
        warn "Bulk npm install failed, retrying individually..."
        while IFS= read -r pkg; do
            [ -z "$pkg" ] && continue
            as_user "export NVM_DIR=\$HOME/.nvm && . \$NVM_DIR/nvm.sh && npm install -g ${pkg}" \
                >>"$LOGFILE" 2>&1 || track_failure "npm:${pkg}"
        done < "$BACKUP_DIR/manifests/npm-globals.txt"
    }
    ok "NPM globals processed"
fi

# --- 2d. Pip Packages ---------------------------------------------------------
hdr "Pip Packages"
if [ -f "$BACKUP_DIR/manifests/pip-user.txt" ] && [ -s "$BACKUP_DIR/manifests/pip-user.txt" ]; then
    log "  Installing user pip packages..."
    as_user "pip3 install --user --break-system-packages -r $BACKUP_DIR/manifests/pip-user.txt" \
        >>"$LOGFILE" 2>&1 || {
        warn "Bulk pip install failed, retrying individually..."
        while IFS= read -r line; do
            pkg=$(echo "$line" | cut -d= -f1)
            [ -z "$pkg" ] && continue
            as_user "pip3 install --user --break-system-packages ${pkg}" \
                >>"$LOGFILE" 2>&1 || track_failure "pip:${pkg}"
        done < "$BACKUP_DIR/manifests/pip-user.txt"
    }
    ok "Pip packages processed"
fi

# --- 2e. pnpm -----------------------------------------------------------------
hdr "pnpm"
as_user "export NVM_DIR=\$HOME/.nvm && . \$NVM_DIR/nvm.sh && corepack enable pnpm" \
    >>"$LOGFILE" 2>&1 || track_failure "pnpm"
ok "pnpm enabled via corepack"

# --- 2f. uv (Python package manager via snap) ---------------------------------
hdr "uv (Astral)"
snap install astral-uv --classic >>"$LOGFILE" 2>&1 || track_failure "snap:astral-uv"
ok "uv installed"

# =============================================================================
#  PHASE 3: Dotfiles & Configs
# =============================================================================
hdr "PHASE 3: Dotfiles & Configs"

# --- 3a. Dotfiles -------------------------------------------------------------
hdr "Restoring Dotfiles"
if [ -d "$BACKUP_DIR/dotfiles" ]; then
    for f in "$BACKUP_DIR/dotfiles/".*; do
        [ ! -f "$f" ] && continue
        fname=$(basename "$f")
        # Don't overwrite .bashrc on Debian — merge instead
        if [ "$fname" = ".bashrc" ]; then
            # Append our customizations if not already present
            if ! grep -q "bashrc.d" "$TARGET_HOME/.bashrc" 2>/dev/null; then
                cat >> "$TARGET_HOME/.bashrc" <<'BASHRC_APPEND'

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Source all files in ~/.bashrc.d
for f in ~/.bashrc.d/*.sh; do [ -r "$f" ] && source "$f"; done

# pnpm
export PNPM_HOME="$HOME/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
alias pip='pip3'

export PATH="/usr/lib/llvm-23/bin:$PATH"

# OpenClaw Auto-Integration
if [ -f ~/.openclaw/.env ]; then
    export $(grep -v '^#' ~/.openclaw/.env | xargs)
fi

# opencode
export PATH=$HOME/.opencode/bin:$PATH
BASHRC_APPEND
                log "  .bashrc — appended dev customizations"
            else
                log "  .bashrc — customizations already present"
            fi
        else
            cp "$f" "$TARGET_HOME/$fname"
            log "  $fname"
        fi
    done

    # Non-dotfiles (like regular named files)
    for f in "$BACKUP_DIR/dotfiles/"[!.]*; do
        [ ! -f "$f" ] && continue
        fname=$(basename "$f")
        cp "$f" "$TARGET_HOME/$fname"
        log "  $fname"
    done

    # .bashrc.d directory
    if [ -d "$BACKUP_DIR/dotfiles/bashrc.d" ]; then
        mkdir -p "$TARGET_HOME/.bashrc.d"
        cp -a "$BACKUP_DIR/dotfiles/bashrc.d/"* "$TARGET_HOME/.bashrc.d/"
        ok ".bashrc.d/ restored ($(ls "$TARGET_HOME/.bashrc.d/" | wc -l) files)"
    fi
fi

# --- 3b. Git Config -----------------------------------------------------------
hdr "Git Config"
as_user 'git config --global user.name "jdgafx"'
as_user 'git config --global user.email "jdgafx@users.noreply.github.com"'
as_user 'git config --global push.autoSetupRemote true'
as_user 'git config --global pull.rebase false'
as_user 'git config --global credential.helper store'
ok "Git global config set"

# Restore git credentials
if [ -f "$BACKUP_DIR/dotfiles/.git-credentials" ]; then
    cp "$BACKUP_DIR/dotfiles/.git-credentials" "$TARGET_HOME/.git-credentials"
    chmod 600 "$TARGET_HOME/.git-credentials"
    ok "Git credentials restored"
fi

# --- 3c. SSH Keys -------------------------------------------------------------
hdr "SSH Keys"
if [ -d "$BACKUP_DIR/ssh" ]; then
    mkdir -p "$TARGET_HOME/.ssh"
    # Don't blindly overwrite — only copy what's in backup
    find "$BACKUP_DIR/ssh/" -type f | while read -r f; do
        fname=$(basename "$f")
        cp "$f" "$TARGET_HOME/.ssh/$fname"
    done
    chmod 700 "$TARGET_HOME/.ssh"
    chmod 600 "$TARGET_HOME/.ssh/"* 2>/dev/null || true
    chmod 644 "$TARGET_HOME/.ssh/"*.pub 2>/dev/null || true
    chmod 644 "$TARGET_HOME/.ssh/known_hosts" 2>/dev/null || true
    ok "SSH keys restored"
fi

# =============================================================================
#  PHASE 4: Dev Tools (Claude, OpenCode, rclone, etc.)
# =============================================================================
hdr "PHASE 4: Dev Tools & AI Assistants"

# --- 4a. Claude Code ---------------------------------------------------------
hdr "Claude Code"
# Install Claude CLI
if ! as_user 'command -v claude' &>/dev/null; then
    log "Installing Claude Code CLI..."
    as_user "export NVM_DIR=\$HOME/.nvm && . \$NVM_DIR/nvm.sh && npm install -g @anthropic-ai/claude-code" \
        >>"$LOGFILE" 2>&1 || track_failure "claude-code-install"
fi

# Restore Claude config
if [ -d "$BACKUP_DIR/claude" ]; then
    mkdir -p "$TARGET_HOME/.claude"
    for item in settings.json settings.local.json .credentials.json statusline-command.sh; do
        [ -f "$BACKUP_DIR/claude/$item" ] && \
            cp "$BACKUP_DIR/claude/$item" "$TARGET_HOME/.claude/" && \
            log "  .claude/$item"
    done

    # Scripts & hooks
    if [ -d "$BACKUP_DIR/claude/scripts" ]; then
        cp -a "$BACKUP_DIR/claude/scripts" "$TARGET_HOME/.claude/"
        chmod +x "$TARGET_HOME/.claude/scripts/"*.sh 2>/dev/null || true
        chmod +x "$TARGET_HOME/.claude/scripts/hooks/"*.sh 2>/dev/null || true
        ok "Claude scripts & hooks restored"
    fi

    # Plugins
    if [ -d "$BACKUP_DIR/claude/plugins" ]; then
        cp -a "$BACKUP_DIR/claude/plugins" "$TARGET_HOME/.claude/"
        ok "Claude plugins restored"
    fi

    # Project memory
    if [ -d "$BACKUP_DIR/claude/projects-memory" ]; then
        mkdir -p "$TARGET_HOME/.claude/projects"
        cp -a "$BACKUP_DIR/claude/projects-memory/"* "$TARGET_HOME/.claude/projects/" 2>/dev/null || true
        ok "Claude project memory restored"
    fi

    # Project directories (just the structure, not heavy data)
    if [ -d "$BACKUP_DIR/claude/projects" ]; then
        cp -a "$BACKUP_DIR/claude/projects" "$TARGET_HOME/.claude/"
        ok "Claude projects config restored"
    fi
fi

# --- 4b. OpenCode ------------------------------------------------------------
hdr "OpenCode"
# Install OpenCode
if ! as_user 'command -v opencode' &>/dev/null; then
    log "Installing OpenCode..."
    as_user 'curl -fsSL https://opencode.ai/install.sh | bash' >>"$LOGFILE" 2>&1 || \
    as_user 'curl -fsSL https://get.opencode.ai | bash' >>"$LOGFILE" 2>&1 || \
        track_failure "opencode-install"
fi

# Restore OpenCode config
if [ -d "$BACKUP_DIR/configs/opencode" ]; then
    mkdir -p "$TARGET_HOME/.config/opencode"
    cp -a "$BACKUP_DIR/configs/opencode/"* "$TARGET_HOME/.config/opencode/"
    ok "OpenCode config restored"
fi

if [ -d "$BACKUP_DIR/configs/opencode-data" ]; then
    mkdir -p "$TARGET_HOME/.local/share/opencode"
    cp -a "$BACKUP_DIR/configs/opencode-data/"* "$TARGET_HOME/.local/share/opencode/"
    ok "OpenCode auth data restored"
fi

# --- 4c. OpenClaw -------------------------------------------------------------
hdr "OpenClaw"
if [ -d "$BACKUP_DIR/configs/openclaw" ]; then
    cp -a "$BACKUP_DIR/configs/openclaw" "$TARGET_HOME/.openclaw"
    ok "OpenClaw config restored"
fi

# --- 4d. Antigravity ----------------------------------------------------------
hdr "Antigravity"
if [ -d "$BACKUP_DIR/configs/Antigravity" ]; then
    mkdir -p "$TARGET_HOME/.config/Antigravity"
    cp -a "$BACKUP_DIR/configs/Antigravity/"* "$TARGET_HOME/.config/Antigravity/"
    ok "Antigravity config restored"
fi

# --- 4e. GitHub CLI -----------------------------------------------------------
hdr "GitHub CLI"
if ! command -v gh &>/dev/null; then
    log "Installing GitHub CLI..."
    (type -p wget >/dev/null || apt-get install -y wget) && \
    mkdir -p -m 755 /etc/apt/keyrings && \
    out=$(mktemp) && \
    wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli-stable.list > /dev/null && \
    apt-get update -qq && apt-get install -y gh >>"$LOGFILE" 2>&1 || track_failure "gh-cli"
fi

if [ -d "$BACKUP_DIR/configs/gh" ]; then
    mkdir -p "$TARGET_HOME/.config/gh"
    cp -a "$BACKUP_DIR/configs/gh/"* "$TARGET_HOME/.config/gh/"
    ok "gh CLI config restored"
fi

# --- 4f. Rclone ---------------------------------------------------------------
hdr "Rclone"
if ! command -v rclone &>/dev/null; then
    log "Installing rclone..."
    curl -fsSL https://rclone.org/install.sh | bash >>"$LOGFILE" 2>&1 || track_failure "rclone"
fi

if [ -d "$BACKUP_DIR/configs/rclone" ]; then
    mkdir -p "$TARGET_HOME/.config/rclone"
    cp -a "$BACKUP_DIR/configs/rclone/"* "$TARGET_HOME/.config/rclone/"
    ok "Rclone config restored"
fi

# --- 4g. Tailscale ------------------------------------------------------------
hdr "Tailscale"
if ! command -v tailscale &>/dev/null; then
    log "Installing Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | bash >>"$LOGFILE" 2>&1 || track_failure "tailscale"
fi

# --- 4h. Google Chrome & Chrome Canary ----------------------------------------
hdr "Google Chrome"
if ! command -v google-chrome &>/dev/null; then
    log "Installing Google Chrome..."
    wget -q -O /tmp/chrome.deb "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb" && \
    dpkg -i /tmp/chrome.deb >>"$LOGFILE" 2>&1 || apt-get install -fy >>"$LOGFILE" 2>&1
    rm -f /tmp/chrome.deb
    ok "Google Chrome installed"
fi

# Chrome Canary repo is already in sources.list.d from backup
if ! dpkg -l google-chrome-canary &>/dev/null 2>&1; then
    apt-get update -qq 2>>"$LOGFILE" || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y google-chrome-canary >>"$LOGFILE" 2>&1 || \
        warn "Chrome Canary may not be available yet (repo imported)"
fi

# Restore browser bookmarks/prefs
for browser in google-chrome google-chrome-canary; do
    if [ -d "$BACKUP_DIR/configs/$browser" ]; then
        mkdir -p "$TARGET_HOME/.config/$browser/Default"
        for f in Bookmarks Preferences "Local State"; do
            [ -f "$BACKUP_DIR/configs/$browser/$f" ] && \
                cp "$BACKUP_DIR/configs/$browser/$f" "$TARGET_HOME/.config/$browser/Default/" 2>/dev/null
            [ -f "$BACKUP_DIR/configs/$browser/$f" ] && \
                cp "$BACKUP_DIR/configs/$browser/$f" "$TARGET_HOME/.config/$browser/" 2>/dev/null
        done
        log "  $browser bookmarks restored"
    fi
done

# --- 4i. Fish Shell Config ----------------------------------------------------
hdr "Fish Shell"
if [ -d "$BACKUP_DIR/configs/fish" ]; then
    mkdir -p "$TARGET_HOME/.config/fish"
    cp -a "$BACKUP_DIR/configs/fish/"* "$TARGET_HOME/.config/fish/"
    ok "Fish config restored"
fi

# =============================================================================
#  PHASE 5: CLAUDE.md & Dev Repos
# =============================================================================
hdr "PHASE 5: CLAUDE.md & Dev Repos"

# --- 5a. CLAUDE.md files ------------------------------------------------------
for f in "$BACKUP_DIR/configs/"*CLAUDE.md; do
    [ ! -f "$f" ] && continue
    fname=$(basename "$f")
    if echo "$fname" | grep -q "_home_chris_CLAUDE"; then
        cp "$f" "$TARGET_HOME/CLAUDE.md"
        log "  ~/CLAUDE.md restored"
    elif echo "$fname" | grep -q "_home_chris_dev_CLAUDE"; then
        mkdir -p "$TARGET_HOME/dev"
        cp "$f" "$TARGET_HOME/dev/CLAUDE.md"
        log "  ~/dev/CLAUDE.md restored"
    fi
done

# --- 5b. Clone dev repos -----------------------------------------------------
hdr "Cloning Dev Repos"
if [ -f "$BACKUP_DIR/manifests/dev-repos.txt" ]; then
    mkdir -p "$TARGET_HOME/dev"

    while IFS='|' read -r dirname remote branch; do
        # Skip comments and non-repos
        [[ "$dirname" =~ ^# ]] && continue
        [ "$remote" = "NOT_A_REPO" ] && continue
        [ "$remote" = "LOCAL_ONLY" ] && continue
        [ -z "$remote" ] && continue

        target="$TARGET_HOME/dev/$dirname"
        if [ -d "$target/.git" ]; then
            log "  ${dirname} — already exists, skipping"
            continue
        fi

        log "  Cloning ${dirname}..."
        as_user "git clone --depth=1 '${remote}' '${target}'" >>"$LOGFILE" 2>&1 || {
            # Try without depth limit
            as_user "git clone '${remote}' '${target}'" >>"$LOGFILE" 2>&1 || \
                track_failure "git-clone:${dirname}"
        }

        # Checkout correct branch if not main/master
        if [ -n "$branch" ] && [ "$branch" != "main" ] && [ "$branch" != "master" ]; then
            as_user "cd '${target}' && git checkout '${branch}'" >>"$LOGFILE" 2>&1 || true
        fi
    done < "$BACKUP_DIR/manifests/dev-repos.txt"

    ok "Dev repos processed"
fi

# --- 5c. Crontab -------------------------------------------------------------
hdr "Crontab"
if [ -f "$BACKUP_DIR/configs/crontab.txt" ] && [ -s "$BACKUP_DIR/configs/crontab.txt" ]; then
    crontab -u "$TARGET_USER" "$BACKUP_DIR/configs/crontab.txt" 2>/dev/null || \
        warn "Could not restore crontab"
    ok "Crontab restored"
fi

# --- 5d. Systemd User Services -----------------------------------------------
hdr "Systemd User Services"
if [ -f "$BACKUP_DIR/manifests/systemd-user-enabled.txt" ] && [ -s "$BACKUP_DIR/manifests/systemd-user-enabled.txt" ]; then
    while IFS= read -r svc; do
        [ -z "$svc" ] && continue
        as_user "systemctl --user enable '${svc}'" >>"$LOGFILE" 2>&1 || true
    done < "$BACKUP_DIR/manifests/systemd-user-enabled.txt"
    ok "User services re-enabled"
fi

# =============================================================================
#  PHASE 6: Fix Ownership & Permissions
# =============================================================================
hdr "PHASE 6: Fixing Ownership"
chown -R "${TARGET_USER}:${TARGET_USER}" "$TARGET_HOME" 2>>"$LOGFILE"
ok "All files owned by ${TARGET_USER}"

# Fix SSH permissions specifically
chmod 700 "$TARGET_HOME/.ssh" 2>/dev/null || true
find "$TARGET_HOME/.ssh" -type f -name "*.pub" -exec chmod 644 {} \; 2>/dev/null || true
find "$TARGET_HOME/.ssh" -type f ! -name "*.pub" ! -name "known_hosts*" ! -name "config" -exec chmod 600 {} \; 2>/dev/null || true

# =============================================================================
#  SUMMARY
# =============================================================================
hdr "RESTORE COMPLETE"
echo ""
ok "Log file: ${LOGFILE}"

if [ ${#FAILED_STEPS[@]} -gt 0 ]; then
    echo ""
    warn "The following steps had issues (${#FAILED_STEPS[@]} total):"
    printf "  - %s\n" "${FAILED_STEPS[@]}"
    echo ""
    warn "These are non-blocking. Review the log for details."
else
    echo ""
    ok "All steps completed successfully!"
fi

echo ""
echo -e "${BOLD}Next steps:${NC}"
echo -e "  1. ${CYAN}Log out and back in${NC} (or run: source ~/.bashrc)"
echo -e "  2. ${CYAN}tailscale up${NC} — to reconnect Tailscale"
echo -e "  3. ${CYAN}rclone config reconnect gdrive:${NC} — if Google Drive auth expired"
echo -e "  4. ${CYAN}claude${NC} — to re-authenticate Claude Code"
echo -e "  5. ${CYAN}gh auth login${NC} — if GitHub CLI needs re-auth"
echo ""
echo -e "${GREEN}${BOLD}Your dev environment is ready!${NC}"

# Cleanup extraction directory
rm -rf "$EXTRACT_DIR"
