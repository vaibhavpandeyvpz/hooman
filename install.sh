#!/usr/bin/env bash
# Install Bun (if needed), then install the latest hoomanjs globally via Bun.
# macOS & Linux:
#   curl -fsSL https://raw.githubusercontent.com/vaibhavpandeyvpz/hooman/main/install.sh | bash
set -euo pipefail

CYAN=$'\033[38;2;0;145;205m'
MUTED=$'\033[38;2;155;165;168m'
GREEN=$'\033[38;2;142;192;108m'
RED=$'\033[38;2;238;76;88m'
NC=$'\033[0m'

info() { printf '%s\n' "$*"; }
ok() { printf '%s%s%s\n' "$GREEN" "$*" "$NC"; }
err() { printf '%s%s%s\n' "$RED" "$*" "$NC" >&2; }

bun_bin_dir() {
  if [[ -n "${BUN_INSTALL:-}" ]]; then
    printf '%s\n' "${BUN_INSTALL%/}/bin"
  else
    printf '%s\n' "${HOME}/.bun/bin"
  fi
}

ensure_path_has_bun() {
  local bin
  bin="$(bun_bin_dir)"
  if [[ -d "$bin" && ":${PATH}:" != *":${bin}:"* ]]; then
    export PATH="${bin}:${PATH}"
  fi
  if [[ -n "${GITHUB_PATH:-}" && -d "$bin" ]]; then
    echo "$bin" >>"$GITHUB_PATH"
  fi
}

ensure_bun() {
  ensure_path_has_bun
  if command -v bun >/dev/null 2>&1; then
    info "${MUTED}Bun already installed:${NC} $(bun --version)"
    return 0
  fi

  info "${MUTED}Installing Bun…${NC}"
  if ! command -v curl >/dev/null 2>&1; then
    err "Error: curl is required to install Bun."
    exit 1
  fi

  curl -fsSL https://bun.sh/install | bash
  ensure_path_has_bun

  if ! command -v bun >/dev/null 2>&1; then
    err "Error: Bun installed but is not on PATH."
    err "Add $(bun_bin_dir) to your PATH and re-run this script."
    exit 1
  fi

  ok "Bun $(bun --version) installed."
}

install_hooman() {
  info "${MUTED}Installing latest${NC} hoomanjs ${MUTED}with Bun…${NC}"
  bun add -g hoomanjs@latest
  ensure_path_has_bun
}

print_success() {
  local version=""
  if command -v hooman >/dev/null 2>&1; then
    version="$(hooman --version 2>/dev/null || true)"
  fi

  printf '\n'
  printf '%s' "$CYAN"
  cat <<'EOF'
  _
 | |__   ___   ___  _ __ ___   __ _ _ __
 | '_ \ / _ \ / _ \| '_ ` _ \ / _` | '_ \
 | | | | (_) | (_) | | | | | | (_| | | | |
 |_| |_|\___/ \___/|_| |_| |_|\__,_|_| |_|
EOF
  printf '%s\n\n' "$NC"

  if [[ -n "$version" ]]; then
    ok "Installed hooman ${version}"
  else
    ok "Installed hoomanjs"
  fi

  printf '\n'
  info "${MUTED}Get started:${NC}"
  info "  hooman          ${MUTED}# interactive chat${NC}"
  info "  hooman exec \"…\" ${MUTED}# one-shot prompt${NC}"
  info "  hooman --help   ${MUTED}# all commands${NC}"
  printf '\n'
  info "${MUTED}Docs:${NC} https://vaibhavpandey.com/hooman/"
  printf '\n'
}

ensure_bun
install_hooman
print_success
