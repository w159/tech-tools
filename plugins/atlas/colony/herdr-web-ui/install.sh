#!/bin/sh
# herdr web ui in one line, from a PC that may have none of it yet:
#
#   curl -fsSL https://devswha.github.io/herdr-web-ui/install.sh | sh
#
# 1. Installs what is missing, for this user only and without sudo: herdr (its own installer, into
#    ~/.local/bin), Bun (its own installer, into ~/.bun) and Node 22 (the official build, checked
#    against its published SHA-256, into ~/.local/share/herdr-web-ui/node).
# 2. Installs herdr web ui as a herdr plugin, so it starts with herdr and Settings → Updates keeps it
#    current, and starts it now when herdr is running.
# 3. When Tailscale runs on this PC, serves the app to your tailnet (`tailscale serve`, on the first
#    free HTTPS port) and prints the address a phone opens as a QR code (scripts/plugin.ts phone).
#
# Run it again at any time: what is already there is kept, and step 3 is repeated.
#   HERDR_WEB_UI_REF=<branch or tag>   install that ref instead of the latest release
set -eu

REPO="devswha/herdr-web-ui"
PLUGIN="devswha.herdr-web-ui"
BIN_DIR="$HOME/.local/bin"
NODE_DIR="$HOME/.local/share/herdr-web-ui/node"
# Official digests from nodejs.org/dist/v22.23.2/SHASUMS256.txt, as scripts/build-remote-bundle.ts pins them
NODE_VERSION="v22.23.2"

say() { printf '%s\n' "herdr web ui: $*"; }
# a clickable address in a terminal (OSC 8); $terminal is set once, since $(link …) runs in a pipe
# shellcheck disable=SC1003 # the backslashes end OSC 8 escapes (ESC \\), no quote is escaped
link() { if [ "$terminal" = 1 ]; then printf '\033]8;;%s\033\\%s\033]8;;\033\\' "$1" "$1"; else printf '%s' "$1"; fi; }
fail() { printf '%s\n' "herdr web ui: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "needs '$1', which is not installed. Install it and run this again."; }
# The highest vX.Y.Z tag, as the updater picks it: a new install gets what existing ones run,
# never the commits merged to main since the last release.
latest_release() {
  git ls-remote --tags --refs "https://github.com/$REPO.git" 'v*' 2>/dev/null |
    sed -n 's|.*refs/tags/\(v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$|\1|p' |
    sort -t. -k1.2,1n -k2,2n -k3,3n | tail -n 1
}
# at_least 1.4.0 1.10.2: is the second dotted version the first or newer
at_least() {
  awk -v want="$1" -v have="$2" 'BEGIN { split(want, w, "."); split(have, h, ".");
    for (i = 1; i <= 3; i++) { if (h[i] + 0 > w[i] + 0) exit 0; if (h[i] + 0 < w[i] + 0) exit 1 } exit 0 }'
}
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{ print $1 }'; }

install_node() {
  case "$platform" in
    linux-x64) node_sha=b294a556e639d64338823920e5866c21c02741742d2e1529ee1a225c1ec9252a ;;
    linux-arm64) node_sha=013b59cfd2819703a6f4a14ab891fc46fc2a4e3f5bcd92de3fb4929b43e35b30 ;;
    darwin-x64) node_sha=58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026 ;;
    darwin-arm64) node_sha=61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6 ;;
  esac
  say "installing Node $NODE_VERSION into $NODE_DIR"
  tmp=$(mktemp -d)
  archive="$tmp/node.tar.gz"
  curl -fsSL --retry 3 "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$platform.tar.gz" -o "$archive"
  [ "$(sha256 "$archive")" = "$node_sha" ] || { rm -rf "$tmp"; fail "the Node download does not match its published SHA-256; nothing was installed"; }
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR" "$BIN_DIR"
  tar -xzf "$archive" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
  # an older node elsewhere on the PATH would still win in a new shell, so this one goes first in ours
  [ -e "$BIN_DIR/node" ] || ln -s "$NODE_DIR/bin/node" "$BIN_DIR/node"
  installed_here="$installed_here node"
}

# herdr's checkout stays at the version first installed: Settings → Updates builds each newer release
# in the app's state dir and runs it from there (server/updater.ts, current.json). The directory of the
# code that runs now, so the phone step is the running version's, not the first install's.
running_code() {
  state="${HERDR_WEB_STATE_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-web-ui}"
  head=$(git -C "$1" rev-parse HEAD 2>/dev/null || true)
  # shellcheck disable=SC2016 # JavaScript, not shell
  bun -e '
    const [root, state, head] = process.argv.slice(1);
    const { readdirSync, readFileSync } = await import("node:fs");
    let found = root;
    try {
      for (const name of readdirSync(`${state}/updates`)) {
        try {
          const saved = JSON.parse(readFileSync(`${state}/updates/${name}/current.json`, "utf8"));
          if (saved.source_revision === head && String(saved.directory).startsWith(`${state}/updates/${name}/release-`)) found = saved.directory;
        } catch {}
      }
    } catch {}
    console.log(found);
  ' "$1" "$state" "$head"
}

main() {
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) fail "runs on Linux and macOS; this is $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) fail "runs on x64 and arm64; this is $(uname -m)" ;;
  esac
  platform="$os-$arch"
  terminal=0
  [ ! -t 1 ] || terminal=1
  if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
    fail "the terminal addon has no build for musl (Alpine); use a glibc distribution"
  fi
  need curl
  need git
  need tar

  original_path="$PATH"
  installed_here=""
  new_install=0
  PATH="$BIN_DIR:$HOME/.bun/bin:$NODE_DIR/bin:$PATH"
  export PATH

  if ! command -v herdr >/dev/null 2>&1; then
    say "installing herdr (https://herdr.dev) into $BIN_DIR"
    curl -fsSL https://herdr.dev/install.sh | sh
    command -v herdr >/dev/null 2>&1 || fail "herdr did not install; see https://herdr.dev/docs/install/"
    installed_here="$installed_here herdr"
  fi
  herdr_version=$(herdr --version 2>/dev/null | awk '{ print $2 }')
  at_least 0.9.0 "${herdr_version:-0}" \
    || fail "needs herdr 0.9.0 or newer; this is ${herdr_version:-unknown}. Update it (https://herdr.dev/docs/install/), restart herdr, and run this again."

  if command -v bun >/dev/null 2>&1; then
    bun_version=$(bun --version)
    if ! at_least 1.4.0 "$bun_version"; then
      say "updating Bun $bun_version to the latest"
      bun upgrade </dev/null || fail "could not update Bun $bun_version; update it to 1.4 or newer and run this again"
    fi
  else
    need unzip
    say "installing Bun (https://bun.sh) into ~/.bun"
    curl -fsSL https://bun.sh/install | bash
    command -v bun >/dev/null 2>&1 || fail "Bun did not install; see https://bun.sh"
    # Bun's installer adds ~/.bun/bin to a shell's rc file only when it can tell which shell, and
    # herdr runs the app with the PATH it was started with: next to herdr, it is found either way
    mkdir -p "$BIN_DIR"
    [ -e "$BIN_DIR/bun" ] || ln -s "$HOME/.bun/bin/bun" "$BIN_DIR/bun"
    installed_here="$installed_here bun"
  fi

  node_major=$(node --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\).*/\1/p')
  [ "${node_major:-0}" -ge 18 ] || install_node

  if herdr plugin list 2>/dev/null | grep -q "$PLUGIN "; then
    say "already installed as a herdr plugin; Settings → Updates keeps it current"
  else
    need git
    ref=${HERDR_WEB_UI_REF:-$(latest_release)}
    [ -n "$ref" ] || fail "could not look up the latest release on github.com. Check the connection and run this again."
    say "installing the herdr plugin at $ref (herdr clones and builds it: about a minute)"
    # herdr previews the whole manifest first; on success its last word is enough, on failure all of it
    log=$(mktemp)
    if herdr plugin install "$REPO" --ref "$ref" --yes </dev/null >"$log" 2>&1; then
      grep '^Installed ' "$log" || true
      rm -f "$log"
      new_install=1
    else
      cat "$log" >&2
      rm -f "$log"
      fail "herdr could not install the plugin; its output is above"
    fi
  fi

  root=$(herdr plugin list --json | bun -e 'const d = JSON.parse(await Bun.stdin.text()); console.log(d.result.plugins.find((p) => p.plugin_id === "'"$PLUGIN"'")?.plugin_root ?? "")')
  [ -n "$root" ] || fail "herdr does not list the plugin after installing it; see: herdr plugin list"

  if herdr status server --json 2>/dev/null | grep -q '"running":true'; then
    # the action only queues the start (its output goes to herdr's plugin log), so wait for it here
    herdr plugin action invoke "$PLUGIN.start" >/dev/null </dev/null
    tries=0
    until bun "$root/scripts/plugin.ts" status </dev/null | grep -q '^running'; do
      tries=$((tries + 1))
      [ "$tries" -lt 25 ] || {
        say "did not start within 25 s; see: herdr plugin log list"
        # the start ran inside herdr, so what it said is in herdr's plugin log, not on this terminal
        # shellcheck disable=SC2016 # JavaScript, not shell
        herdr plugin log list 2>/dev/null </dev/null | bun -e 'const logs = JSON.parse(await Bun.stdin.text()).result.logs.filter((log) => log.plugin_id === process.argv[1] && log.stderr); if (logs.length > 0) console.error(logs.at(-1).stderr.trim())' "$PLUGIN" || true
        break
      }
      sleep 1
    done
  else
    say "herdr is not running, so neither is the app yet: it starts with herdr. Run: herdr"
  fi

  echo
  code=$(running_code "$root")
  if grep -q '"phone"' "$code/scripts/plugin.ts" 2>/dev/null; then
    bun "$code/scripts/plugin.ts" phone </dev/null || true
  else
    # a release from before the phone step: the address the running app already knows, as a QR code
    origin=$(bun "$root/scripts/plugin.ts" status </dev/null | awk '$1 == "running" { print $2 }')
    url=""
    [ -z "$origin" ] || url=$(curl -fsS --max-time 5 "$origin/api/access" 2>/dev/null | bun -e 'try { console.log(JSON.parse(await Bun.stdin.text()).tailscale?.serving_url ?? "") } catch { console.log("") }')
    [ -z "$origin" ] || say "on this PC: $(link "$origin")"
    if [ -n "$url" ]; then
      say "on your phone: $(link "$url")"
      # the app's own QR library, there since 0.3.11 for Settings → Phone
      if [ -d "$code/node_modules/qrcode-generator" ]; then
        # shellcheck disable=SC2016 # JavaScript, not shell
        (cd "$code" && bun -e 'const { default: qr } = await import("qrcode-generator"); const c = qr(0, "M"); c.addData(process.argv[1]); c.make(); console.log(c.createASCII(1, 1))' "$url") || true
      fi
    else
      say "no phone address yet, and this version cannot set one up: update it in Settings → Updates, then run this again"
    fi
  fi

  # once, on the first install; a rerun for the phone address stays quiet
  if [ "$new_install" = 1 ]; then
    echo
    say "if it helps you, a GitHub star helps other herdr users find it: $(link "https://github.com/$REPO")"
  fi

  case ":$original_path:" in
    *":$BIN_DIR:"*) ;;
    *)
      if [ -z "$installed_here" ]; then
        :
      elif grep -qs '\.local/bin' "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.zprofile" "$HOME/.zshrc"; then
        echo
        say "installed$installed_here into $BIN_DIR. Open a new terminal before running herdr, so it finds them."
      else
        echo
        say "installed$installed_here into $BIN_DIR, which your shell does not put on its PATH. Add it, for example:"
        # shellcheck disable=SC2016 # the line to paste, $HOME and $PATH unexpanded
        printf '    echo '\''export PATH="$HOME/.local/bin:$PATH"'\'' >> ~/.profile\n'
        say "and start herdr from a new terminal, so it and the app find them."
      fi
      ;;
  esac
}

# the whole script is read before anything runs: under `curl | sh`, a command that reads stdin
# must not swallow the rest of it
main "$@"
