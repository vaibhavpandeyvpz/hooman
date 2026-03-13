#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/vaibhavpandeyvpz/hooman.git"
APP_USER="hooman"
APP_GROUP=""
APP_HOME=""
INSTALL_DIR=""

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

log() {
  printf "\n[hooman-setup] %s\n" "$1"
}

PROMPT_FD=0

init_prompt_fd() {
  if [[ -r /dev/tty ]]; then
    exec 3</dev/tty
    PROMPT_FD=3
  else
    PROMPT_FD=0
  fi
}

prompt_line() {
  local prompt="$1"
  local out_var="$2"
  local value=""
  read -r -u "${PROMPT_FD}" -p "${prompt}" value || true
  printf -v "${out_var}" "%s" "${value}"
}

prompt_secret() {
  local prompt="$1"
  local out_var="$2"
  local value=""
  read -r -s -u "${PROMPT_FD}" -p "${prompt}" value || true
  echo
  printf -v "${out_var}" "%s" "${value}"
}

run_as_user() {
  local target_user="$1"
  shift
  if [[ -n "${SUDO}" ]]; then
    sudo -u "${target_user}" "$@"
  else
    runuser -u "${target_user}" -- "$@"
  fi
}

require_ubuntu() {
  if [[ ! -f /etc/os-release ]]; then
    echo "Cannot detect OS. This script supports Ubuntu." >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    echo "Detected '${ID:-unknown}'. This script is intended for Ubuntu only." >&2
    exit 1
  fi
}

prompt_inputs() {
  echo "Hooman setup (Ubuntu)"
  echo "Press Enter to keep fields empty for local-only install."
  echo

  prompt_line "Public domain (e.g. hooman.example.com, optional): " PUBLIC_DOMAIN
  prompt_line "Dedicated app user [hooman]: " APP_USER
  APP_USER="${APP_USER:-hooman}"

  if [[ ! "${APP_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
    echo "Invalid username '${APP_USER}'. Use lowercase letters, numbers, _ or -." >&2
    exit 1
  fi
  if [[ "${APP_USER}" == "root" ]]; then
    echo "Using root is not supported. Please choose a dedicated user." >&2
    exit 1
  fi

  if [[ -n "${PUBLIC_DOMAIN}" ]]; then
    USE_DOMAIN="true"
  else
    USE_DOMAIN="false"
  fi

  prompt_line "Web auth username [admin]: " WEB_AUTH_USERNAME
  WEB_AUTH_USERNAME="${WEB_AUTH_USERNAME:-admin}"

  while true; do
    prompt_secret "Web auth password: " WEB_AUTH_PASSWORD
    prompt_secret "Confirm web auth password: " WEB_AUTH_PASSWORD_CONFIRM
    if [[ -z "${WEB_AUTH_PASSWORD}" ]]; then
      echo "Password cannot be empty."
      continue
    fi
    if [[ "${WEB_AUTH_PASSWORD}" != "${WEB_AUTH_PASSWORD_CONFIRM}" ]]; then
      echo "Passwords do not match. Try again."
      continue
    fi
    break
  done
}

setup_dedicated_user() {
  log "Preparing dedicated app user (${APP_USER})"
  if id -u "${APP_USER}" >/dev/null 2>&1; then
    APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"
  else
    ${SUDO} useradd --create-home --shell /bin/bash "${APP_USER}"
    APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"
  fi
  if [[ -z "${APP_HOME}" ]]; then
    echo "Could not determine home directory for ${APP_USER}." >&2
    exit 1
  fi
  APP_GROUP="$(id -gn "${APP_USER}")"
  if [[ -z "${APP_GROUP}" ]]; then
    echo "Could not determine primary group for ${APP_USER}." >&2
    exit 1
  fi
  INSTALL_DIR="${APP_HOME}/hooman"
}

install_system_packages() {
  log "Installing system packages"
  ${SUDO} apt-get update -y
  log "Installing system + Puppeteer runtime dependencies"
  ${SUDO} env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates \
    curl \
    git \
    gnupg \
    jq \
    nginx \
    certbot \
    python3-certbot-nginx \
    build-essential \
    make \
    pkg-config \
    libssl-dev \
    python3 \
    python3-pip \
    python3-venv \
    golang-go \
    tar \
    libgbm-dev \
    libasound2t64 \
    libatk1.0-0t64 \
    libc6 \
    libcairo2 \
    libcups2t64 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc-s1 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0t64 \
    libgtk-3-0t64 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    fonts-liberation \
    libnss3 \
    libayatana-appindicator3-1 \
    lsb-release \
    xdg-utils \
    wget
}

install_nvm_node_yarn() {
  log "Installing Node.js and Yarn"
  if [[ ! -s "${APP_HOME}/.nvm/nvm.sh" ]]; then
    su - "${APP_USER}" -c 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash'
  fi

  local node_version
  node_version="$(cat "${INSTALL_DIR}/.nvmrc" 2>/dev/null || echo "24")"
  su - "${APP_USER}" -c "
    export NVM_DIR=\"${APP_HOME}/.nvm\"
    # shellcheck disable=SC1090
    . \"${APP_HOME}/.nvm/nvm.sh\"
    nvm install ${node_version}
    nvm alias default ${node_version}
    corepack enable
    corepack prepare yarn@stable --activate
  "
}

install_uv_python() {
  log "Installing uv + default Python"
  su - "${APP_USER}" -c '
    set -e
    if ! command -v uv >/dev/null 2>&1; then
      curl -LsSf https://astral.sh/uv/install.sh | sh
    fi
    export PATH="$HOME/.local/bin:$PATH"
    uv python install --default
  '
}

clone_or_update_repo() {
  log "Cloning/updating repository"
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    su - "${APP_USER}" -c "git -C \"${INSTALL_DIR}\" pull --ff-only"
  else
    su - "${APP_USER}" -c "git clone \"${REPO_URL}\" \"${INSTALL_DIR}\""
  fi
}

hash_web_password() {
  local output hash_line pass_escaped
  pass_escaped="$(printf "%q" "${WEB_AUTH_PASSWORD}")"
  output="$(
    su - "${APP_USER}" -c "
      set -e
      export NVM_DIR=\"${APP_HOME}/.nvm\"
      # shellcheck disable=SC1090
      . \"${APP_HOME}/.nvm/nvm.sh\"
      cd \"${INSTALL_DIR}\"
      yarn -s hash-password --password=${pass_escaped}
    "
  )"
  hash_line="$(printf "%s\n" "${output}" | awk 'NF{line=$0} END{print line}')"
  if [[ -z "${hash_line}" || "${hash_line}" != \$argon2* ]]; then
    echo "Failed to generate WEB_AUTH_PASSWORD_HASH." >&2
    exit 1
  fi
  WEB_AUTH_PASSWORD_HASH="${hash_line}"
}

write_env_file() {
  log "Writing .env"
  local api_base vite_api_base
  if [[ "${USE_DOMAIN}" == "true" ]]; then
    api_base="https://${PUBLIC_DOMAIN}"
    vite_api_base="${api_base}"
  else
    api_base="http://localhost:3000"
    vite_api_base="${api_base}"
  fi

  JWT_SECRET="$(openssl rand -hex 32)"

  cat > "${INSTALL_DIR}/.env" <<EOF
API_BASE_URL=${api_base}
CHROMA_URL=http://127.0.0.1:8000
JWT_SECRET=${JWT_SECRET}
REDIS_URL=redis://127.0.0.1:6379
VITE_API_BASE=${vite_api_base}
WEB_AUTH_USERNAME=${WEB_AUTH_USERNAME}
WEB_AUTH_PASSWORD_HASH=${WEB_AUTH_PASSWORD_HASH}
EOF
}

install_node_deps() {
  log "Installing Node dependencies"
  su - "${APP_USER}" -c "
    set -e
    export NVM_DIR=\"${APP_HOME}/.nvm\"
    # shellcheck disable=SC1090
    . \"${APP_HOME}/.nvm/nvm.sh\"
    cd \"${INSTALL_DIR}\"
    yarn install
  "
}

build_project() {
  log "Building project"
  su - "${APP_USER}" -c "
    set -e
    export NVM_DIR=\"${APP_HOME}/.nvm\"
    # shellcheck disable=SC1090
    . \"${APP_HOME}/.nvm/nvm.sh\"
    cd \"${INSTALL_DIR}\"
    yarn build
  "
}

run_db_migrations() {
  log "Running database migrations"
  su - "${APP_USER}" -c "
    set -e
    export NVM_DIR=\"${APP_HOME}/.nvm\"
    # shellcheck disable=SC1090
    . \"${APP_HOME}/.nvm/nvm.sh\"
    cd \"${INSTALL_DIR}\"
    yarn db:migrate
  "
}

publish_frontend_assets() {
  log "Publishing frontend assets to /var/www/hooman"
  ${SUDO} mkdir -p /var/www/hooman/apps/frontend
  ${SUDO} rm -rf /var/www/hooman/apps/frontend/dist
  ${SUDO} cp -a "${INSTALL_DIR}/apps/frontend/dist" /var/www/hooman/apps/frontend/dist
  ${SUDO} chown -R root:root /var/www/hooman
  ${SUDO} chmod -R a+rX /var/www/hooman
}

ensure_app_ownership() {
  log "Ensuring ${APP_USER}:${APP_GROUP} ownership on ${INSTALL_DIR}"
  ${SUDO} chown -R "${APP_USER}:${APP_GROUP}" "${INSTALL_DIR}"
}

install_native_valkey() {
  if command -v valkey-server >/dev/null 2>&1; then
    log "Valkey already installed"
  else
    log "Installing Valkey natively"
    if ${SUDO} env DEBIAN_FRONTEND=noninteractive apt-get install -y valkey; then
      :
    else
      local valkey_tarball_url tmp_dir src_dir
      valkey_tarball_url="$(
        curl -fsSL "https://api.github.com/repos/valkey-io/valkey/releases/latest" | jq -r ".tarball_url"
      )"
      if [[ -z "${valkey_tarball_url}" || "${valkey_tarball_url}" == "null" ]]; then
        echo "Unable to determine latest Valkey tarball URL." >&2
        exit 1
      fi
      tmp_dir="$(mktemp -d)"
      src_dir="${tmp_dir}/valkey-src"
      mkdir -p "${src_dir}"
      curl -fsSL "${valkey_tarball_url}" -o "${tmp_dir}/valkey.tar.gz"
      tar -xzf "${tmp_dir}/valkey.tar.gz" -C "${src_dir}" --strip-components=1
      (cd "${src_dir}" && make -j"$(nproc)" && ${SUDO} make install)
      rm -rf "${tmp_dir}"
    fi
  fi

  local valkey_server_bin valkey_cli_bin
  valkey_server_bin="$(command -v valkey-server || true)"
  valkey_cli_bin="$(command -v valkey-cli || true)"
  if [[ -z "${valkey_server_bin}" || -z "${valkey_cli_bin}" ]]; then
    echo "Valkey binaries not found after installation." >&2
    exit 1
  fi

  ${SUDO} id -u valkey >/dev/null 2>&1 || ${SUDO} useradd --system --no-create-home --shell /usr/sbin/nologin valkey
  ${SUDO} mkdir -p /etc/valkey /var/lib/valkey
  ${SUDO} chown -R valkey:valkey /var/lib/valkey

  ${SUDO} tee /etc/valkey/valkey.conf >/dev/null <<EOF
bind 127.0.0.1
port 6379
daemonize no
supervised no
dir /var/lib/valkey
save 900 1
save 300 10
save 60 10000
appendonly yes
loglevel notice
EOF

  ${SUDO} tee /etc/systemd/system/valkey.service >/dev/null <<EOF
[Unit]
Description=Valkey In-Memory Data Store
After=network.target

[Service]
Type=simple
User=valkey
Group=valkey
ExecStart=/usr/local/bin/valkey-server /etc/valkey/valkey.conf
ExecStop=/usr/local/bin/valkey-cli -p 6379 shutdown
Restart=always
RestartSec=2
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

  ${SUDO} sed -i "s#/usr/local/bin/valkey-server#${valkey_server_bin}#g" /etc/systemd/system/valkey.service
  ${SUDO} sed -i "s#/usr/local/bin/valkey-cli#${valkey_cli_bin}#g" /etc/systemd/system/valkey.service

  ${SUDO} systemctl daemon-reload
  ${SUDO} systemctl enable --now valkey
}

install_native_chroma() {
  log "Installing Chroma natively"
  ${SUDO} id -u chroma >/dev/null 2>&1 || ${SUDO} useradd --system --create-home --home-dir /opt/chroma --shell /usr/sbin/nologin chroma
  ${SUDO} mkdir -p /opt/chroma /var/lib/chroma
  ${SUDO} chown -R chroma:chroma /opt/chroma /var/lib/chroma

  run_as_user chroma python3 -m venv /opt/chroma/.venv
  run_as_user chroma /opt/chroma/.venv/bin/pip install --upgrade pip
  run_as_user chroma /opt/chroma/.venv/bin/pip install chromadb

  ${SUDO} tee /etc/chroma.env >/dev/null <<EOF
IS_PERSISTENT=TRUE
PERSIST_DIRECTORY=/var/lib/chroma
ANONYMIZED_TELEMETRY=FALSE
EOF

  ${SUDO} tee /etc/systemd/system/chroma.service >/dev/null <<EOF
[Unit]
Description=Chroma Vector Database
After=network.target

[Service]
Type=simple
User=chroma
Group=chroma
EnvironmentFile=/etc/chroma.env
WorkingDirectory=/opt/chroma
ExecStart=/opt/chroma/.venv/bin/chroma run --host 127.0.0.1 --port 8000 --path /var/lib/chroma
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  ${SUDO} systemctl daemon-reload
  ${SUDO} systemctl enable --now chroma
}

setup_native_services() {
  install_native_valkey
  install_native_chroma
}

setup_nginx_and_certs() {
  if [[ "${USE_DOMAIN}" != "true" ]]; then
    log "Skipping nginx/certbot (local-only install)"
    return
  fi

  log "Configuring nginx"
  local frontend_conf
  frontend_conf="$(mktemp)"

  sed "s/hooman.example.com/${PUBLIC_DOMAIN}/g" \
    "${INSTALL_DIR}/.nginx/hooman.conf" > "${frontend_conf}"

  ${SUDO} cp "${frontend_conf}" /etc/nginx/sites-available/hooman.conf
  ${SUDO} ln -sf /etc/nginx/sites-available/hooman.conf /etc/nginx/sites-enabled/hooman.conf
  ${SUDO} rm -f /etc/nginx/sites-enabled/hooman-frontend.conf /etc/nginx/sites-enabled/hooman-api.conf
  ${SUDO} rm -f /etc/nginx/sites-enabled/default
  ${SUDO} nginx -t
  ${SUDO} systemctl reload nginx

  log "Requesting TLS certificates with certbot"
  local cert_email="admin@${PUBLIC_DOMAIN}"
  ${SUDO} certbot --nginx \
    --non-interactive \
    --agree-tos \
    --redirect \
    -m "${cert_email}" \
    -d "${PUBLIC_DOMAIN}"
}

start_pm2() {
  log "Starting Hooman with PM2"
  su - "${APP_USER}" -c "
    set -e
    export NVM_DIR=\"${APP_HOME}/.nvm\"
    # shellcheck disable=SC1090
    . \"${APP_HOME}/.nvm/nvm.sh\"
    cd \"${INSTALL_DIR}\"
    yarn start
    npx pm2 save
  "

  local startup_cmd
  startup_cmd="$(
    su - "${APP_USER}" -c "
      export NVM_DIR=\"${APP_HOME}/.nvm\"
      # shellcheck disable=SC1090
      . \"${APP_HOME}/.nvm/nvm.sh\"
      npx pm2 startup systemd -u \"${APP_USER}\" --hp \"${APP_HOME}\" 2>/dev/null
    " | awk '/sudo/ {print; exit}'
  )"

  if [[ -n "${startup_cmd}" ]]; then
    # Remove leading sudo; we already control privilege escalation.
    startup_cmd="${startup_cmd#sudo }"
    ${SUDO} bash -lc "${startup_cmd}" || true
  fi
}

print_summary() {
  log "Setup complete"
  echo "Dedicated app user: ${APP_USER}"
  echo "Install directory: ${INSTALL_DIR}"
  if [[ "${USE_DOMAIN}" == "true" ]]; then
    echo "App URL: https://${PUBLIC_DOMAIN}"
    echo "API URL: https://${PUBLIC_DOMAIN}/api"
  else
    echo "Frontend (dev only): run 'yarn dev:frontend' in ${INSTALL_DIR}"
    echo "API health: http://localhost:3000/health"
  fi
  echo "PM2 status: su - ${APP_USER} -c 'cd ${INSTALL_DIR} && npx pm2 status'"
  echo "Valkey status: sudo systemctl status valkey --no-pager"
  echo "Chroma status: sudo systemctl status chroma --no-pager"
  echo
}

main() {
  require_ubuntu
  init_prompt_fd
  prompt_inputs
  setup_dedicated_user
  install_system_packages
  clone_or_update_repo
  install_nvm_node_yarn
  install_uv_python
  setup_native_services
  install_node_deps
  hash_web_password
  write_env_file
  build_project
  run_db_migrations
  publish_frontend_assets
  setup_nginx_and_certs
  ensure_app_ownership
  start_pm2
  print_summary
}

main "$@"
