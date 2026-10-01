/**
 * `need` — the box's on-demand tool installer, so a task that needs a CLI the image lacks never ends
 * in "X isn't installed here". Two layers, both installed by the bootstrap on every run:
 *
 *   · /usr/local/bin/need <cmd...>  — installs each missing command: a curated map first (cf,
 *     kubectl, aws, az, helm, terraform, …: vendor binaries or the right apt package name, which is
 *     rarely the command's name), then apt → npm → pip by name. Idempotent; prints what it did.
 *   · /etc/asb-need.sh — a bash `command_not_found_handle` that runs `need` on the missing command
 *     and re-executes the original command line when the install succeeds. Sourced through
 *     BASH_ENV (non-interactive `bash -c`, which is what agent shell tools run) and from
 *     /etc/bash.bashrc. Drivers whose shell is not bash still have `need` and the prompt rule.
 *
 * Installs are a side effect inside a disposable microVM owned by the task; the agent is root there
 * by design. Nothing here reads or prints credentials.
 */
import { shellQuote } from "../exec.js";

export const NEED_PATH = "/usr/local/bin/need";
export const NEED_HOOK = "/etc/asb-need.sh";

/** The `need` script. POSIX sh (the image's /bin/sh is dash). */
export function needScript(): string {
  return `#!/bin/sh
# need <cmd...>: install each missing command, then exit 0 if all are now on PATH. See src/drivers/need.ts.
set -u
BIN=/usr/local/bin
arch() { case "$(uname -m)" in x86_64|amd64) echo amd64;; aarch64|arm64) echo arm64;; *) uname -m;; esac; }
apt_i() { export DEBIAN_FRONTEND=noninteractive; [ -f /var/lib/apt/periodic/asb-updated ] || { apt-get update -qq >/dev/null 2>&1 && mkdir -p /var/lib/apt/periodic && touch /var/lib/apt/periodic/asb-updated; }; apt-get install -y -qq "$@" >/dev/null 2>&1; }
gh_latest() { curl -fsSL "https://api.github.com/repos/$1/releases/latest" | sed -n 's/.*"tag_name": *"\\([^"]*\\)".*/\\1/p' | head -1; }
fetch_tgz() { # url, member path inside the archive, dest name
  t=$(mktemp -d) && curl -fsSL "$1" | tar -xz -C "$t" && f=$(find "$t" -type f -name "$2" | head -1) && [ -n "$f" ] && install -m 755 "$f" "$BIN/$3"; r=$?; rm -rf "$t"; return $r; }
fetch_bin() { curl -fsSL -o "$BIN/$2" "$1" && chmod +x "$BIN/$2"; }
install_one() {
  c=$1; a=$(arch)
  case "$c" in
    cf) v=$(gh_latest cloudfoundry/cli | sed 's/^v//'); fetch_tgz "https://github.com/cloudfoundry/cli/releases/download/v$v/cf8-cli_$v""_linux_x86-64.tgz" cf8 cf && ln -sf "$BIN/cf" "$BIN/cf8" ;;
    kubectl) v=$(curl -fsSL https://dl.k8s.io/release/stable.txt); fetch_bin "https://dl.k8s.io/release/$v/bin/linux/$a/kubectl" kubectl ;;
    helm) curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash >/dev/null 2>&1 ;;
    aws) t=$(mktemp -d) && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "$t/a.zip" && (apt_i unzip; cd "$t" && unzip -q a.zip && ./aws/install >/dev/null 2>&1); r=$?; rm -rf "$t"; return $r ;;
    az) pip3 install --break-system-packages -q azure-cli >/dev/null 2>&1 || pip3 install -q azure-cli >/dev/null 2>&1 ;;
    gcloud) curl -fsSL https://sdk.cloud.google.com | bash -s -- --disable-prompts --install-dir=/opt >/dev/null 2>&1 && ln -sf /opt/google-cloud-sdk/bin/gcloud "$BIN/gcloud" && ln -sf /opt/google-cloud-sdk/bin/gsutil "$BIN/gsutil" ;;
    terraform) v=$(gh_latest hashicorp/terraform | sed 's/^v//'); t=$(mktemp -d) && curl -fsSL "https://releases.hashicorp.com/terraform/$v/terraform_$v""_linux_$a.zip" -o "$t/t.zip" && (apt_i unzip; unzip -q "$t/t.zip" -d "$BIN"); r=$?; rm -rf "$t"; return $r ;;
    yq) fetch_bin "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_$a" yq ;;
    bun) curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 && ln -sf "$HOME/.bun/bin/bun" "$BIN/bun" ;;
    deno) curl -fsSL https://deno.land/install.sh | sh -s -- -y >/dev/null 2>&1 && ln -sf "$HOME/.deno/bin/deno" "$BIN/deno" ;;
    uv|uvx) curl -fsSL https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 && ln -sf "$HOME/.local/bin/uv" "$BIN/uv" && ln -sf "$HOME/.local/bin/uvx" "$BIN/uvx" ;;
    cargo|rustc|rustup) curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null 2>&1 && for b in cargo rustc rustup; do ln -sf "$HOME/.cargo/bin/$b" "$BIN/$b"; done ;;
    go) v=$(curl -fsSL "https://go.dev/VERSION?m=text" | head -1); curl -fsSL "https://go.dev/dl/$v.linux-$a.tar.gz" | tar -xz -C /usr/local && ln -sf /usr/local/go/bin/go "$BIN/go" && ln -sf /usr/local/go/bin/gofmt "$BIN/gofmt" ;;
    docker) apt_i docker.io || apt_i docker-cli ;;
    psql|pg_dump) apt_i postgresql-client ;;
    mysql|mysqldump) apt_i default-mysql-client ;;
    redis-cli) apt_i redis-tools ;;
    mongosh) npm i -g mongosh >/dev/null 2>&1 ;;
    rg) apt_i ripgrep ;;
    fd) apt_i fd-find && ln -sf "$(command -v fdfind)" "$BIN/fd" ;;
    bat) apt_i bat && ln -sf "$(command -v batcat)" "$BIN/bat" ;;
    pip|pip3) apt_i python3-pip ;;
    python|python3) apt_i python3 python3-pip python3-venv && ln -sf "$(command -v python3)" "$BIN/python" ;;
    java|javac) apt_i default-jdk-headless ;;
    mvn) apt_i maven ;;
    gradle) apt_i gradle ;;
    dotnet) apt_i dotnet-sdk-8.0 ;;
    php) apt_i php-cli ;;
    ruby|gem|bundle) apt_i ruby-full ;;
    pnpm) npm i -g pnpm >/dev/null 2>&1 ;;
    yarn) npm i -g yarn >/dev/null 2>&1 ;;
    tsc) npm i -g typescript >/dev/null 2>&1 ;;
    vercel|netlify|wrangler|firebase|supabase|serverless|eas|expo|ngrok|prisma|nx|turbo|pm2|http-server|serve|playwright) npm i -g "$c" >/dev/null 2>&1 ;;
    firebase) npm i -g firebase-tools >/dev/null 2>&1 ;;
    wrangler) npm i -g wrangler >/dev/null 2>&1 ;;
    flyctl|fly) curl -fsSL https://fly.io/install.sh | sh >/dev/null 2>&1 && ln -sf "$HOME/.fly/bin/flyctl" "$BIN/flyctl" && ln -sf "$HOME/.fly/bin/flyctl" "$BIN/fly" ;;
    heroku) curl -fsSL https://cli-assets.heroku.com/install.sh | sh >/dev/null 2>&1 ;;
    doctl) v=$(gh_latest digitalocean/doctl | sed 's/^v//'); fetch_tgz "https://github.com/digitalocean/doctl/releases/download/v$v/doctl-$v-linux-$a.tar.gz" doctl doctl ;;
    stripe) v=$(gh_latest stripe/stripe-cli | sed 's/^v//'); fetch_tgz "https://github.com/stripe/stripe-cli/releases/download/v$v/stripe_$v""_linux_x86_64.tar.gz" stripe stripe ;;
    k9s) fetch_tgz "https://github.com/derailed/k9s/releases/latest/download/k9s_Linux_$a.tar.gz" k9s k9s ;;
    kustomize) curl -fsSL "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh" | bash -s -- "$BIN" >/dev/null 2>&1 ;;
    sqlite3|jq|curl|wget|unzip|zip|make|gcc|g++|cmake|tmux|htop|nmap|dig|nc|ncat|socat|rsync|ffmpeg|imagemagick|convert|graphviz|dot|pandoc|tree|lsof|strace|ltrace|gdb|lldb|vim|nano|less|file|xz|bzip2|zstd|openssl|ssh|sshpass|git-lfs|shellcheck|shfmt)
      case "$c" in dig) p=dnsutils;; nc|ncat) p=netcat-openbsd;; convert) p=imagemagick;; dot) p=graphviz;; g++) p=g++;; gcc) p=build-essential;; ssh) p=openssh-client;; *) p=$c;; esac
      apt_i "$p" ;;
    *) apt_i "$c" || npm i -g "$c" >/dev/null 2>&1 || pip3 install --break-system-packages -q "$c" >/dev/null 2>&1 || pip3 install -q "$c" >/dev/null 2>&1 ;;
  esac
}
rc=0
for c in "$@"; do
  case "$c" in -h|--help) echo "usage: need <command>...  installs each missing command (curated map, then apt/npm/pip)"; exit 0;; esac
  if command -v "$c" >/dev/null 2>&1; then continue; fi
  echo "need: installing $c…" >&2
  if install_one "$c" && command -v "$c" >/dev/null 2>&1; then echo "need: installed $c ($(command -v "$c"))" >&2
  else echo "need: could not install $c automatically — try the vendor's install steps, or ask the caller" >&2; rc=1; fi
done
exit $rc
`;
}

/**
 * Bash fallback: when a command is missing, install it with `need` and run the original command
 * line. Only ever fires for a command that would have failed with 127 anyway, so a failed install
 * returns the same "command not found" the shell would have given.
 */
export function needHook(): string {
  return `# asb: auto-install a missing command, then run it (src/drivers/need.ts)
command_not_found_handle() {
  if [ -x ${NEED_PATH} ] && [ -z "\${ASB_NEED_BUSY:-}" ] && ASB_NEED_BUSY=1 ${NEED_PATH} "$1" && command -v "$1" >/dev/null 2>&1; then
    "$@"; return $?
  fi
  printf 'bash: %s: command not found\\n' "$1" >&2
  return 127
}
`;
}

/** Shell fragment for the bootstrap: install `need`, the hook, and wire it into every bash. */
export function needSetup(): string {
  const need = Buffer.from(needScript(), "utf8").toString("base64");
  const hook = Buffer.from(needHook(), "utf8").toString("base64");
  return (
    `printf '%s' '${need}' | base64 -d > ${NEED_PATH} && chmod +x ${NEED_PATH} && ` +
    `printf '%s' '${hook}' | base64 -d > ${NEED_HOOK} && ` +
    // Interactive shells source bash.bashrc; non-interactive `bash -c` reads $BASH_ENV (exported
    // for the agent process by agentEnvFlags, and from /etc/profile.d for login shells).
    `(grep -q asb-need /etc/bash.bashrc 2>/dev/null || echo ${shellQuote(`. ${NEED_HOOK}`)} >> /etc/bash.bashrc) && ` +
    `printf '%s\\n' ${shellQuote(`export BASH_ENV=${NEED_HOOK}`)} > /etc/profile.d/asb-need.sh`
  );
}
