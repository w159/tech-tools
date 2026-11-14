"""Security regressions: the shipped auvik bundle and the enterprise setup guide.

auvik: the bundle must not read <cwd>/.env (dotenv's default path) and must
accept only real Auvik shards as AUVIK_REGION, so no launch directory or env
value can point the Basic-auth request at another host.

setup.md: the gateway staging block must copy every file the gateway
Dockerfile COPYs, or the documented `docker build` fails.
"""

import json
import os
import re
import shlex
import shutil
import subprocess
from pathlib import Path

import pytest

PLUGIN = Path(__file__).resolve().parents[1]
REPO = PLUGIN.parents[1]
AUVIK_BUNDLE = PLUGIN / "mcp/auvik/server.mjs"
LOAD_MJS = PLUGIN / "mcp/_env/load.mjs"
SETUP_MD = PLUGIN / "skills/armada-enterprise/references/setup.md"
GATEWAY_DOCKERFILE = REPO / "mcp_servers/mcp-gateway/Dockerfile"

NODE = shutil.which("node")

# Replaces fetch before the bundle loads: records every URL on stderr and
# answers 401, so the test makes no network call and sends no credential.
FETCH_STUB = """
globalThis.fetch = async (url) => {
  process.stderr.write(`FETCH ${String(url)}\\n`);
  return new Response('{"errors":[{"title":"stub"}]}', {
    status: 401, headers: { 'content-type': 'application/json' },
  });
};
"""


def _auvik_status(tmp_path: Path, env_extra: dict, dotenv: str | None = None):
    """Launch the bundle as .mcp.json does, from a fresh cwd, and call auvik_status."""
    cwd = tmp_path / "launch"
    home = tmp_path / "home"
    cwd.mkdir()
    home.mkdir()
    if dotenv is not None:
        (cwd / ".env").write_text(dotenv)
    stub = tmp_path / "fetch-stub.mjs"
    stub.write_text(FETCH_STUB)
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(home),
        "MCP_TRANSPORT": "stdio",
    }
    env.update(env_extra)
    msgs = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "armada-test", "version": "0"},
            },
        },
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "auvik_status", "arguments": {}},
        },
    ]
    proc = subprocess.Popen(
        [NODE, "--import", str(stub), "--import", str(LOAD_MJS), str(AUVIK_BUNDLE)],
        cwd=cwd,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    payload = None
    try:
        for m in msgs:
            proc.stdin.write(json.dumps(m) + "\n")
            proc.stdin.flush()
        for line in proc.stdout:
            line = line.strip()
            if not line.startswith("{"):
                continue
            msg = json.loads(line)
            if msg.get("id") == 2:
                payload = json.loads(msg["result"]["content"][0]["text"])
                break
    finally:
        proc.stdin.close()
        proc.terminate()
        stderr = proc.stderr.read()
        proc.wait(timeout=10)
    assert payload is not None, stderr
    fetched = re.findall(r"^FETCH (\S+)", stderr, re.M)
    return payload, fetched, stderr


VALID_HOST = re.compile(
    r"^https://auvikapi\.(us[1-6]|eu[12]|au1|ca1)\.my\.auvik\.com/v1/"
)
CREDS = {"AUVIK_USERNAME": "user@example.invalid", "AUVIK_API_KEY": "dummy-key"}


@pytest.mark.skipif(NODE is None, reason="no node")
def test_auvik_ignores_launch_dir_dotenv_region(tmp_path):
    payload, fetched, stderr = _auvik_status(
        tmp_path, CREDS, dotenv="AUVIK_REGION=evil.example/\n"
    )
    assert payload["region"] == "us1", payload
    assert payload["baseUrl"].startswith("https://auvikapi.us1.my.auvik.com/v1"), (
        payload
    )
    assert fetched and all(VALID_HOST.match(u) for u in fetched), fetched


@pytest.mark.skipif(NODE is None, reason="no node")
def test_auvik_ignores_launch_dir_dotenv_credentials(tmp_path):
    dotenv = "AUVIK_USERNAME=a@example.invalid\nAUVIK_API_KEY=k\n"
    payload, fetched, _ = _auvik_status(tmp_path, {}, dotenv=dotenv)
    assert payload["hasCredentials"] is False, payload
    assert fetched == []


@pytest.mark.skipif(NODE is None, reason="no node")
@pytest.mark.parametrize(
    "region", ["x.localhost:48443/", "evil.example/", "us1.evil", "US1 ", "us9"]
)
def test_auvik_rejects_invalid_env_region(tmp_path, region):
    payload, fetched, stderr = _auvik_status(
        tmp_path, {**CREDS, "AUVIK_REGION": region}
    )
    assert payload["region"] == "us1", payload
    assert re.match(
        r"^https://auvikapi\.us1\.my\.auvik\.com/v1 ", payload["baseUrl"]
    ), payload
    assert fetched and all(VALID_HOST.match(u) for u in fetched), fetched
    assert "AUVIK_REGION" in stderr and "us1" in stderr, stderr


@pytest.mark.skipif(NODE is None, reason="no node")
def test_auvik_keeps_valid_env_region(tmp_path):
    payload, fetched, _ = _auvik_status(tmp_path, {**CREDS, "AUVIK_REGION": "eu2"})
    assert payload["region"] == "eu2", payload
    assert fetched and all(
        u.startswith("https://auvikapi.eu2.my.auvik.com/v1/") for u in fetched
    )


def _staged_files(text: str) -> set[str]:
    """Build-context paths that the setup.md staging block's `cp` lines create.

    Paths are relative to `$STAGE`, the staged build context, so they compare
    directly with the Dockerfile's COPY sources (repo-root relative).
    """
    staged = set()
    for line in text.splitlines():
        if not line.strip().startswith("cp "):
            continue
        args = [a for a in shlex.split(line.strip())[1:] if not a.startswith("-")]
        if len(args) < 2 or not args[-1].startswith("$STAGE/"):
            continue
        *sources, dest = args
        rel = dest.removeprefix("$STAGE/")
        if dest.endswith("/") or len(sources) > 1:
            staged.update(rel.rstrip("/") + "/" + src.rstrip("/").rsplit("/", 1)[-1] for src in sources)
        else:
            staged.add(rel)
    return staged


def _dockerfile_copy_sources(text: str) -> set[str]:
    """COPY sources taken from the build context (`COPY --from=...` excluded)."""
    sources = set()
    for line in text.splitlines():
        parts = line.split()
        if not parts or parts[0].upper() != "COPY" or any(p.startswith("--from") for p in parts):
            continue
        args = [p for p in parts[1:] if not p.startswith("--")]
        sources.update(a.rstrip("/") for a in args[:-1])
    return sources


def _covered(src: str, staged: set[str]) -> bool:
    return any(src == s or src.startswith(s + "/") for s in staged)


def test_setup_md_stages_every_gateway_dockerfile_copy_source():
    staged = _staged_files(SETUP_MD.read_text())
    assert staged, "no `cp ... \"$STAGE/...\"` staging lines found in setup.md"
    missing = sorted(
        s
        for s in _dockerfile_copy_sources(GATEWAY_DOCKERFILE.read_text())
        if not _covered(s, staged)
    )
    assert not missing, f"setup.md never stages: {missing} (staged: {sorted(staged)})"
