#!/usr/bin/env bash
###############################################################################
# capture.sh — Snapshot the entire dev environment for transfer
#
# Captures: APT packages + repos + keyrings, snap packages, pip packages,
#           npm globals, NVM, Bun, dotfiles, SSH keys, Claude Code config,
#           OpenCode config, rclone config, git config, dev repo manifest,
#           systemd user services, crontab, CLAUDE.md, and more.
#
# Output:   A single compressed tarball uploaded to Google Drive via rclone.
# Usage:    bash capture.sh            (interactive — prompts for sudo)
#           bash capture.sh --yes      (auto-confirm everything)
###############################################################################
set -euo pipefail
IFS=$'\n\t'

# --- Configuration -----------------------------------------------------------
BACKUP_NAME="linux-sysconfig-$(hostname)-$(date +%Y%m%d-%H%M%S)"
STAGING_DIR="${HOME}/.cache/sysconfig-capture/${BACKUP_NAME}"
TARBALL="${HOME}/.cache/sysconfig-capture/${BACKUP_NAME}.tar.zst"
GDRIVE_DEST="gdrive:Linux-Sysconfig-Backups"
AUTOYES="${1:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; }
hdr()  { echo -e "\n${CYAN}${BOLD}=== $* ===${NC}"; }

die() { err "$*"; exit 1; }

# Sudo helper — uses SUDO_PASSWORD env var if set, otherwise prompts
do_sudo() {
    if [ -n "${SUDO_PASSWORD:-}" ]; then
        echo "$SUDO_PASSWORD" | sudo -S "$@" 2>/dev/null
    else
        sudo "$@"
    fi
}

confirm() {
    [[ "$AUTOYES" == "--yes" ]] && return 0
    read -rp "$(echo -e "${YELLOW}[?]${NC} $* [Y/n] ")" ans
    [[ -z "$ans" || "$ans" =~ ^[Yy] ]]
}

# --- Pre-flight checks -------------------------------------------------------
command -v tar  >/dev/null || die "tar is required"
command -v zstd >/dev/null || { warn "zstd not found, installing..."; do_sudo apt-get install -y zstd; }

hdr "Linux Sysconfig Capture — ${BACKUP_NAME}"
log "Staging directory: ${STAGING_DIR}"
mkdir -p "${STAGING_DIR}"/{manifests,configs,dotfiles,claude,opencode,ssh,keyrings,apt-sources,scripts}

# --- 1. APT Packages ---------------------------------------------------------
hdr "APT Packages"
log "Exporting installed package list..."
dpkg --get-selections | grep -v deinstall | awk '{print $1}' \
    > "${STAGING_DIR}/manifests/apt-packages.txt"
log "  $(wc -l < "${STAGING_DIR}/manifests/apt-packages.txt") packages captured"

# Manually-installed (not auto-installed deps)
apt-mark showmanual 2>/dev/null | sort \
    > "${STAGING_DIR}/manifests/apt-manual.txt" || true
log "  $(wc -l < "${STAGING_DIR}/manifests/apt-manual.txt") manually-installed packages"

# --- 2. APT Repos & Keyrings -------------------------------------------------
hdr "APT Repositories & Keyrings"
log "Copying /etc/apt/sources.list.d/..."
do_sudo cp -a /etc/apt/sources.list.d/* "${STAGING_DIR}/apt-sources/" 2>/dev/null || true
do_sudo cp /etc/apt/sources.list "${STAGING_DIR}/apt-sources/sources.list" 2>/dev/null || true

log "Copying signing keyrings..."
do_sudo find /usr/share/keyrings /etc/apt/keyrings /etc/apt/trusted.gpg.d \
    -name "*.gpg" -type f 2>/dev/null | while read -r keyring; do
    do_sudo cp "$keyring" "${STAGING_DIR}/keyrings/" 2>/dev/null || true
done
log "  $(ls "${STAGING_DIR}/keyrings/" 2>/dev/null | wc -l) keyrings captured"

# Fix permissions so tarball doesn't need root to read
do_sudo chown -R "$(id -u):$(id -g)" "${STAGING_DIR}/apt-sources" "${STAGING_DIR}/keyrings" 2>/dev/null || true

# --- 3. Snap Packages --------------------------------------------------------
hdr "Snap Packages"
if command -v snap &>/dev/null; then
    snap list 2>/dev/null | tail -n +2 | awk '{
        if ($NF == "classic") print $1, "--classic";
        else print $1
    }' > "${STAGING_DIR}/manifests/snap-packages.txt"
    log "  $(wc -l < "${STAGING_DIR}/manifests/snap-packages.txt") snap packages"
else
    warn "snap not installed, skipping"
    touch "${STAGING_DIR}/manifests/snap-packages.txt"
fi

# --- 4. Flatpak Packages -----------------------------------------------------
hdr "Flatpak Packages"
if command -v flatpak &>/dev/null; then
    flatpak list --app --columns=application 2>/dev/null \
        > "${STAGING_DIR}/manifests/flatpak-packages.txt" || true
    log "  $(wc -l < "${STAGING_DIR}/manifests/flatpak-packages.txt") flatpak packages"
else
    warn "flatpak not installed, skipping"
    touch "${STAGING_DIR}/manifests/flatpak-packages.txt"
fi

# --- 5. NPM Global Packages --------------------------------------------------
hdr "NPM Global Packages"
if command -v npm &>/dev/null; then
    npm list -g --depth=0 --json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for pkg, info in data.get('dependencies', {}).items():
    ver = info.get('version', 'latest')
    # Skip npm itself and corepack
    if pkg not in ('npm', 'corepack'):
        print(f'{pkg}@{ver}')
" > "${STAGING_DIR}/manifests/npm-globals.txt" 2>/dev/null || true
    log "  $(wc -l < "${STAGING_DIR}/manifests/npm-globals.txt") npm global packages"
else
    touch "${STAGING_DIR}/manifests/npm-globals.txt"
fi

# --- 6. Pip Packages ---------------------------------------------------------
hdr "Pip Packages"
if command -v pip3 &>/dev/null; then
    # Only capture user-installed, not system packages
    pip3 list --user --format=freeze 2>/dev/null \
        > "${STAGING_DIR}/manifests/pip-user.txt" || true
    pip3 list --format=freeze 2>/dev/null \
        > "${STAGING_DIR}/manifests/pip-all.txt" || true
    log "  $(wc -l < "${STAGING_DIR}/manifests/pip-all.txt") total pip packages"
else
    touch "${STAGING_DIR}/manifests/pip-user.txt"
    touch "${STAGING_DIR}/manifests/pip-all.txt"
fi

# --- 7. NVM (Node Version Manager) -------------------------------------------
hdr "NVM & Node Versions"
if [ -d "$HOME/.nvm" ]; then
    ls "$HOME/.nvm/versions/node/" 2>/dev/null \
        > "${STAGING_DIR}/manifests/nvm-versions.txt"
    # Capture which version is default
    [ -s "$HOME/.nvm/alias/default" ] && \
        cat "$HOME/.nvm/alias/default" > "${STAGING_DIR}/manifests/nvm-default.txt" || \
        echo "v22.22.0" > "${STAGING_DIR}/manifests/nvm-default.txt"
    log "  Node versions: $(cat "${STAGING_DIR}/manifests/nvm-versions.txt" | tr '\n' ' ')"
else
    warn "NVM not found"
    touch "${STAGING_DIR}/manifests/nvm-versions.txt"
fi

# --- 8. Bun -------------------------------------------------------------------
hdr "Bun"
if command -v bun &>/dev/null; then
    bun --version > "${STAGING_DIR}/manifests/bun-version.txt" 2>/dev/null
    log "  Bun $(cat "${STAGING_DIR}/manifests/bun-version.txt")"
else
    touch "${STAGING_DIR}/manifests/bun-version.txt"
fi

# --- 9. Dotfiles & Shell Config -----------------------------------------------
hdr "Dotfiles & Shell Config"
for f in .bashrc .bash_aliases .bash_profile .profile .zshrc .inputrc .npmrc .gitconfig .git-credentials; do
    [ -f "$HOME/$f" ] && cp "$HOME/$f" "${STAGING_DIR}/dotfiles/" && log "  $f"
done

# .bashrc.d directory (critical — has dev-env.sh, openclaw, opencode scripts)
if [ -d "$HOME/.bashrc.d" ]; then
    cp -a "$HOME/.bashrc.d" "${STAGING_DIR}/dotfiles/bashrc.d"
    log "  .bashrc.d/ ($(ls "$HOME/.bashrc.d/" | wc -l) files)"
fi

# --- 10. SSH Keys -------------------------------------------------------------
hdr "SSH Keys"
if [ -d "$HOME/.ssh" ]; then
    cp -a "$HOME/.ssh/"* "${STAGING_DIR}/ssh/" 2>/dev/null || true
    cp -a "$HOME/.ssh/".* "${STAGING_DIR}/ssh/" 2>/dev/null || true
    # Remove socket files
    find "${STAGING_DIR}/ssh/" -type s -delete 2>/dev/null || true
    chmod 700 "${STAGING_DIR}/ssh"
    chmod 600 "${STAGING_DIR}/ssh/"* 2>/dev/null || true
    log "  $(ls "${STAGING_DIR}/ssh/" 2>/dev/null | wc -l) SSH files captured"
fi

# --- 11. Git Config -----------------------------------------------------------
hdr "Git Config"
git config --global --list 2>/dev/null > "${STAGING_DIR}/configs/git-global.txt"
log "  Git global config captured"

# --- 12. Claude Code Config --------------------------------------------------
hdr "Claude Code Config"
if [ -d "$HOME/.claude" ]; then
    # Copy settings, scripts, hooks, plugins — but NOT cache/transcripts/history
    mkdir -p "${STAGING_DIR}/claude"
    for item in settings.json settings.local.json scripts statusline-command.sh; do
        if [ -e "$HOME/.claude/$item" ]; then
            cp -a "$HOME/.claude/$item" "${STAGING_DIR}/claude/"
            log "  .claude/$item"
        fi
    done
    # Plugins — config files only, skip cache/marketplaces
    if [ -d "$HOME/.claude/plugins" ]; then
        mkdir -p "${STAGING_DIR}/claude/plugins"
        for pf in installed_plugins.json known_marketplaces.json blocklist.json; do
            [ -f "$HOME/.claude/plugins/$pf" ] && cp "$HOME/.claude/plugins/$pf" "${STAGING_DIR}/claude/plugins/"
        done
        log "  .claude/plugins (config only)"
    fi
    # Projects directory (CLAUDE.md per project, memory files)
    if [ -d "$HOME/.claude/projects" ]; then
        rsync -a --include='*/' --include='*.md' --include='*.json' \
            --exclude='*' "$HOME/.claude/projects/" "${STAGING_DIR}/claude/projects/" 2>/dev/null || \
            cp -a "$HOME/.claude/projects" "${STAGING_DIR}/claude/"
        log "  .claude/projects"
    fi
    # Copy credentials if present
    [ -f "$HOME/.claude/.credentials.json" ] && \
        cp "$HOME/.claude/.credentials.json" "${STAGING_DIR}/claude/" && \
        log "  .claude/.credentials.json"
fi

# CLAUDE.md files (project-level instructions)
for claude_md in "$HOME/CLAUDE.md" "$HOME/dev/CLAUDE.md"; do
    if [ -f "$claude_md" ]; then
        cp "$claude_md" "${STAGING_DIR}/configs/$(echo "$claude_md" | tr '/' '_').CLAUDE.md"
        log "  $claude_md"
    fi
done

# Claude project memory files
if [ -d "$HOME/.claude/projects" ]; then
    mkdir -p "${STAGING_DIR}/claude/projects-memory"
    find "$HOME/.claude/projects" -name "MEMORY.md" -o -name "*.md" | while read -r f; do
        relpath="${f#$HOME/.claude/projects/}"
        parentdir="$(dirname -- "$relpath")"
        mkdir -p "${STAGING_DIR}/claude/projects-memory/${parentdir}"
        cp "$f" "${STAGING_DIR}/claude/projects-memory/$relpath" 2>/dev/null || true
    done
    log "  Claude project memory files"
fi

# --- 13. OpenCode Config -----------------------------------------------------
hdr "OpenCode Config"
if [ -d "$HOME/.config/opencode" ]; then
    rsync -a --exclude='node_modules' --exclude='cache' "$HOME/.config/opencode/" "${STAGING_DIR}/configs/opencode/"
    log "  .config/opencode/ (excluding node_modules)"
fi
if [ -d "$HOME/.opencode" ]; then
    # Copy config but not heavy caches
    mkdir -p "${STAGING_DIR}/configs/opencode-home"
    for item in bin package.json bun.lock; do
        [ -e "$HOME/.opencode/$item" ] && \
            cp -a "$HOME/.opencode/$item" "${STAGING_DIR}/configs/opencode-home/" 2>/dev/null || true
    done
    log "  .opencode/ (bin + config)"
fi
if [ -d "$HOME/.local/share/opencode" ]; then
    mkdir -p "${STAGING_DIR}/configs/opencode-data"
    cp "$HOME/.local/share/opencode/auth.json" "${STAGING_DIR}/configs/opencode-data/" 2>/dev/null || true
    log "  opencode auth data"
fi

# --- 14. OpenClaw Config -----------------------------------------------------
hdr "OpenClaw Config"
if [ -d "$HOME/.openclaw" ]; then
    rsync -a --exclude='node_modules' --exclude='cache' --exclude='.cache' \
        "$HOME/.openclaw/" "${STAGING_DIR}/configs/openclaw/"
    log "  .openclaw/ (excluding caches)"
fi

# --- 15. Rclone Config -------------------------------------------------------
hdr "Rclone Config"
if [ -f "$HOME/.config/rclone/rclone.conf" ]; then
    mkdir -p "${STAGING_DIR}/configs/rclone"
    cp "$HOME/.config/rclone/rclone.conf" "${STAGING_DIR}/configs/rclone/"
    log "  rclone.conf"
fi

# --- 16. Dev Repo Manifest ---------------------------------------------------
hdr "Dev Repos Manifest"
log "Scanning ~/dev for git repos..."
{
    echo "# Dev repo manifest — directory|remote_url"
    echo "# Generated $(date -Iseconds)"
    for d in "$HOME/dev"/*/; do
        [ ! -d "$d" ] && continue
        dirname="$(basename "$d")"
        if [ -d "$d/.git" ]; then
            remote=$(git -C "$d" remote get-url origin 2>/dev/null || echo "LOCAL_ONLY")
            branch=$(git -C "$d" branch --show-current 2>/dev/null || echo "main")
            echo "${dirname}|${remote}|${branch}"
        else
            echo "${dirname}|NOT_A_REPO|"
        fi
    done
} > "${STAGING_DIR}/manifests/dev-repos.txt"
log "  $(grep -c '|' "${STAGING_DIR}/manifests/dev-repos.txt") repos cataloged"

# --- 17. Systemd User Services -----------------------------------------------
hdr "Systemd User Services"
systemctl --user list-unit-files --state=enabled --no-pager --no-legend 2>/dev/null \
    | awk '{print $1}' > "${STAGING_DIR}/manifests/systemd-user-enabled.txt" || true
log "  $(wc -l < "${STAGING_DIR}/manifests/systemd-user-enabled.txt") enabled user services"

# --- 18. Crontab -------------------------------------------------------------
hdr "Crontab"
crontab -l 2>/dev/null > "${STAGING_DIR}/configs/crontab.txt" || true
log "  User crontab captured"

# --- 19. Misc Configs --------------------------------------------------------
hdr "Additional Configs"
# Chrome / Chrome Canary bookmarks and preferences
for browser_dir in "$HOME/.config/google-chrome" "$HOME/.config/google-chrome-canary"; do
    bname=$(basename "$browser_dir")
    if [ -d "$browser_dir/Default" ]; then
        mkdir -p "${STAGING_DIR}/configs/${bname}"
        for f in Bookmarks Preferences "Local State"; do
            [ -f "$browser_dir/$f" ] && cp "$browser_dir/$f" "${STAGING_DIR}/configs/${bname}/" 2>/dev/null
            [ -f "$browser_dir/Default/$f" ] && cp "$browser_dir/Default/$f" "${STAGING_DIR}/configs/${bname}/" 2>/dev/null
        done
        log "  $bname bookmarks & prefs"
    fi
done

# Fish shell config
[ -d "$HOME/.config/fish" ] && cp -a "$HOME/.config/fish" "${STAGING_DIR}/configs/fish" && log "  fish config"

# GitHub CLI config
[ -d "$HOME/.config/gh" ] && cp -a "$HOME/.config/gh" "${STAGING_DIR}/configs/gh" && log "  gh CLI config"

# Antigravity config
[ -d "$HOME/.config/Antigravity" ] && cp -a "$HOME/.config/Antigravity" "${STAGING_DIR}/configs/Antigravity" && log "  Antigravity config"

# Tailscale — skip state dir (huge, just run `tailscale up` on new machine)
command -v tailscale &>/dev/null && log "  Tailscale installed (will reinstall, just run 'tailscale up')"

# Supermemory script
[ -f "$HOME/.claude/scripts/supermemory.sh" ] && log "  (supermemory script already in claude/scripts)"

# --- 20. System Info Snapshot -------------------------------------------------
hdr "System Info"
{
    echo "hostname=$(hostname)"
    echo "user=$(whoami)"
    echo "uid=$(id -u)"
    echo "gid=$(id -g)"
    echo "shell=$SHELL"
    echo "kernel=$(uname -r)"
    echo "arch=$(uname -m)"
    echo "distro=$(lsb_release -ds 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"')"
    echo "desktop=${XDG_CURRENT_DESKTOP:-unknown}"
    echo "date=$(date -Iseconds)"
} > "${STAGING_DIR}/manifests/system-info.txt"
log "  System snapshot written"

# --- Create Tarball -----------------------------------------------------------
hdr "Creating Compressed Archive"
log "Compressing with zstd (level 9)..."
tar -C "$(dirname "$STAGING_DIR")" -cf - "$BACKUP_NAME" | zstd -9 -T0 -o "$TARBALL"
SIZE=$(du -h "$TARBALL" | cut -f1)
log "Archive: ${TARBALL} (${SIZE})"

# --- Upload to Google Drive ---------------------------------------------------
hdr "Uploading to Google Drive"
if command -v rclone &>/dev/null; then
    if rclone listremotes 2>/dev/null | grep -q "gdrive:"; then
        # Test connectivity
        if ! rclone lsd gdrive: &>/dev/null 2>&1; then
            warn "Google Drive auth expired or not configured"
            warn "Run manually after capture: rclone config reconnect gdrive:"
            warn "Then upload: rclone copy '${TARBALL}' '${GDRIVE_DEST}' --progress"
        fi

        if rclone lsd gdrive: &>/dev/null 2>&1; then
            log "Uploading to ${GDRIVE_DEST}..."
            rclone mkdir "$GDRIVE_DEST" 2>/dev/null || true
            rclone copy "$TARBALL" "$GDRIVE_DEST" --progress --transfers=4 && \
                log "Upload complete!" || warn "Upload failed — archive saved locally"

            # Also upload the bootstrap and restore scripts
            SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            for script in bootstrap.sh restore.sh; do
                [ -f "${SCRIPT_DIR}/${script}" ] && \
                    rclone copy "${SCRIPT_DIR}/${script}" "$GDRIVE_DEST" --progress 2>/dev/null && \
                    log "${script} uploaded to Drive"
            done
        else
            warn "Google Drive not accessible — archive saved locally"
            warn "To upload later: rclone copy '${TARBALL}' '${GDRIVE_DEST}'"
        fi
    else
        warn "rclone 'gdrive' remote not configured"
        warn "Archive saved locally at: ${TARBALL}"
    fi
else
    warn "rclone not installed — archive saved locally at: ${TARBALL}"
fi

# --- Cleanup ------------------------------------------------------------------
rm -rf "${STAGING_DIR}"

hdr "CAPTURE COMPLETE"
log "Backup: ${TARBALL}"
log "GDrive: ${GDRIVE_DEST}/${BACKUP_NAME}.tar.zst"
echo ""
echo -e "${BOLD}On the new machine, run:${NC}"
echo -e "  ${CYAN}curl -fsSL https://raw.githubusercontent.com/jdgafx/Linux-Sysconfig-Package-and-Xfer/main/bootstrap.sh | bash${NC}"
echo ""
echo -e "Or manually: ${CYAN}bash restore.sh /path/to/${BACKUP_NAME}.tar.zst${NC}"
