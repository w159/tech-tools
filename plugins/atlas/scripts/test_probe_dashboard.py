"""probe_dashboard: the Dash HTTP client/starter runs for real against an in-process stub HTTP server
(the dashboard process itself, `ps` and the seeded DB are the external pieces and are stubbed);
probe_dashboard_api and probe_herd run their metric logic against a scripted Dash / ps table."""

import http.server
import json
import sys
import threading
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _test_isolation  # noqa: F401,E402
from scorecard import core  # noqa: E402
from scorecard import probe_dashboard as pd  # noqa: E402


def byname(ms):
    return {m["name"]: m for m in ms}


@pytest.fixture
def ctx(tmp_path):
    root = tmp_path / "plugins" / "atlas"
    (root / "scripts").mkdir(parents=True)
    c = core.Ctx(root, quick=True, work=str(tmp_path / "w"), runs=2)
    c.tmux_real = None
    return c


# --- stub dashboard server ------------------------------------------------------------


class Stub:
    def __init__(self, token="tok123", index=None, health=200):
        self.token = token
        self.index = index if index is not None else f'<meta name="atlas-token" content="{token}">'.encode()
        self.health = health
        self.seen = []
        stub = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _do(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(n) if n else b""
                stub.seen.append((self.command, self.path, dict(self.headers), body))
                if self.path == "/api/health":
                    code, data = stub.health, b"ok"
                elif self.path == "/":
                    code, data = 200, stub.index
                else:
                    code, data = 200, b"x" * 10
                self.send_response(code)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = _do

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


class FakeProc:
    def __init__(self, exit_code=None):
        self.exit_code = exit_code
        self.terminated = self.killed = False
        self.waited = None
        self.wait_raises = False

    def poll(self):
        return self.exit_code

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True

    def wait(self, t):
        self.waited = t
        if self.wait_raises:
            raise pd.subprocess.TimeoutExpired("x", t)


@pytest.fixture
def stub():
    s = Stub()
    yield s
    s.close()


def test_dash_init_prepares_isolated_project(ctx):
    d = pd.Dash(ctx)
    assert d.root == ctx.sub("dash") / "proj"
    assert (d.root / "docs" / "CHANGELOG.md").exists()
    assert not (d.root / ".git").exists()  # with_git=False
    assert isinstance(d.port, int) and d.port > 0
    assert d.proc is None and d.token is None


def test_get_sends_host_token_origin_and_returns_status_body_ms(ctx, stub):
    d = pd.Dash(ctx)
    d.port = stub.port
    d.token = "T"
    st, body, ms = d.get("/api/v2/health", origin="http://o.example")
    assert (st, body) == (200, b"x" * 10)
    assert 0 < ms < 5000  # milliseconds, not seconds
    method, path, hdrs, _ = stub.seen[-1]
    assert (method, path) == ("GET", "/api/v2/health")
    assert hdrs["Host"] == f"127.0.0.1:{stub.port}"
    assert hdrs["X-Atlas-Token"] == "T"
    assert hdrs["Origin"] == "http://o.example"


def test_get_token_false_host_override_and_body(ctx, stub):
    d = pd.Dash(ctx)
    d.port = stub.port
    d.token = "T"
    d.get("/x", token=False, host="evil.example.com")
    hdrs = stub.seen[-1][2]
    assert "X-Atlas-Token" not in hdrs and "Origin" not in hdrs
    assert hdrs["Host"] == "evil.example.com"
    d.get("/p", method="POST", body="{}")
    method, _, hdrs, body = stub.seen[-1]
    assert method == "POST" and body == b"{}"
    assert hdrs["Content-Type"] == "application/json"
    d.get("/g")
    assert "Content-Type" not in stub.seen[-1][2]


def test_get_without_token_set_sends_no_token_header(ctx, stub):
    d = pd.Dash(ctx)
    d.port = stub.port
    d.get("/x")
    assert "X-Atlas-Token" not in stub.seen[-1][2]


def start_with(ctx, monkeypatch, stub, proc):
    monkeypatch.setattr(core, "seed_db", lambda c, db, root: {"kind": "synthetic", "messages": 5})
    popen_args = {}

    def fake_popen(argv, **kw):
        popen_args.update(argv=argv, **kw)
        return proc

    monkeypatch.setattr(pd.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(pd.time, "sleep", lambda s: None)
    d = pd.Dash(ctx)
    d.port = stub.port
    return d, popen_args


def test_start_launches_dashboard_extracts_token_and_registers_cleanup(ctx, monkeypatch, stub):
    d, pa = start_with(ctx, monkeypatch, stub, FakeProc())
    d.start()
    assert d.token == "tok123"
    assert d.db_info == {"kind": "synthetic", "messages": 5}
    argv = pa["argv"]
    assert argv[0] == ctx.py
    assert argv[1] == str(ctx.scripts / "atlas_dashboard.py")
    assert argv[2:] == ["serve", "--foreground", "--host", "127.0.0.1", "--port", str(stub.port)]
    assert pa["env"]["ATLAS_DASHBOARD_PORT"] == str(stub.port)
    assert pa["cwd"] == str(ctx.sub("dash"))
    assert d.stop in ctx.cleanups


def test_start_raises_when_process_exits_early_with_log_tail(ctx, monkeypatch, stub):
    d, _ = start_with(ctx, monkeypatch, stub, FakeProc(exit_code=1))
    log = ctx.sub("dash") / "dash.log"
    monkeypatch.setattr(pd.subprocess, "Popen", lambda argv, **kw: (log.write_text("boom " * 100 + "LASTWORDS"), FakeProc(1))[1])
    with pytest.raises(RuntimeError) as e:
        d.start()
    assert str(e.value).startswith("dashboard exited: ")
    assert str(e.value).endswith("LASTWORDS")
    assert len(str(e.value)) == len("dashboard exited: ") + 300  # exactly the last 300 chars of the log


def test_start_times_out_when_health_never_200(ctx, monkeypatch):
    s = Stub(health=503)
    try:
        d, _ = start_with(ctx, monkeypatch, s, FakeProc())
        with pytest.raises(RuntimeError, match="did not become healthy in 15s"):
            d.start()
    finally:
        s.close()


def test_start_survives_connection_errors_while_waiting(ctx, monkeypatch):
    # nothing listens on this port: OSError on every poll, then the 100-try budget runs out
    monkeypatch.setattr(core, "seed_db", lambda c, db, root: {"kind": "k", "messages": 0})
    monkeypatch.setattr(pd.subprocess, "Popen", lambda argv, **kw: FakeProc())
    sleeps = []
    monkeypatch.setattr(pd.time, "sleep", lambda s: sleeps.append(s))
    d = pd.Dash(ctx)
    d.port = core.free_port()
    with pytest.raises(RuntimeError, match="did not become healthy"):
        d.start()
    assert len(sleeps) == 100 and set(sleeps) == {0.15}


def test_start_without_token_in_index_fails(ctx, monkeypatch):
    s = Stub(index=b"<html>no token</html>")
    try:
        d, _ = start_with(ctx, monkeypatch, s, FakeProc())
        with pytest.raises(RuntimeError, match=r"no token in index \(status 200\)"):
            d.start()
    finally:
        s.close()


def test_stop_terminates_running_proc_and_kills_on_timeout(ctx):
    d = pd.Dash(ctx)
    d.stop()  # no proc: no error
    p = FakeProc()
    d.proc = p
    d.stop()
    assert p.terminated and p.waited == 5 and not p.killed
    p2 = FakeProc()
    p2.wait_raises = True
    d.proc = p2
    d.stop()
    assert p2.terminated and p2.killed
    p3 = FakeProc(exit_code=0)
    d.proc = p3
    d.stop()
    assert not p3.terminated  # already exited


# --- probe_dashboard_api -----------------------------------------------------------------


class FakeDash:
    """Scripted stand-in for Dash: records calls, returns per-path statuses/bodies."""

    instances = []
    start_error = None
    statuses = {}
    guard_status = {}
    open_routes = set()
    ramp = False

    def __init__(self, ctx):
        self.root = Path("/proj")
        self.db_info = {"kind": "synthetic", "messages": 42}
        self.calls = []
        self.stopped = 0
        FakeDash.instances.append(self)

    def start(self):
        if FakeDash.start_error:
            raise FakeDash.start_error

    def stop(self):
        self.stopped += 1

    def get(self, path, token=True, host=None, origin=None, method="GET", body=None):
        self.calls.append(dict(path=path, token=token, host=host, origin=origin, method=method, body=body))
        route = path.split("?")[0].rsplit("/", 1)[-1]
        if host or origin:
            return FakeDash.guard_status.get("hostorigin", 403), b"", 1.0
        if not token and path.split("?")[0] in ("/api/v2/irc", "/api/v2/stream") or (not token and method == "POST"):
            return FakeDash.guard_status.get(path.split("?")[0], 401), b"", 1.0
        if not token:
            return (200 if route in FakeDash.open_routes else 401), b"", 1.0
        st = FakeDash.statuses.get(route, 200)
        size = {"overview": 2048, "health": 4096}.get(route, 100)
        if FakeDash.ramp:
            n = sum(1 for c in self.calls if c["path"] == path and c["token"]) - 1
            return st, b"y" * size, float(n)
        return st, b"y" * size, 10.0


@pytest.fixture
def fake(monkeypatch):
    FakeDash.instances = []
    FakeDash.start_error = None
    FakeDash.statuses = {}
    FakeDash.guard_status = {}
    FakeDash.open_routes = set()
    FakeDash.ramp = False
    monkeypatch.setattr(pd, "Dash", FakeDash)
    return FakeDash


def test_api_start_failure_gives_error_pair_and_stops(ctx, fake):
    fake.start_error = RuntimeError("no port")
    out = pd.probe_dashboard_api(ctx)
    assert [o["name"] for o in out] == ["dashboard_up", "dashboard_api_worst_p95_ms"]
    assert all(o["state"] == "error" and o["reason"] == "dashboard would not start: no port" for o in out)
    assert fake.instances[0].stopped == 1


def test_api_happy_path_metrics(ctx, fake):
    out = pd.probe_dashboard_api(ctx)
    m = byname(out)
    up = m["dashboard_up"]
    assert up["value"] == 1 and up["note"] == "DB: synthetic (42 messages)"
    d = fake.instances[0]
    assert d.stopped == 1
    # every route sampled ctx.n (=2) times, with the project query string
    route_calls = [c for c in d.calls if c["path"].startswith("/api/v2/overview?project=") and not (c["host"] or c["origin"])]
    assert len([c for c in route_calls if c["token"]]) == 2
    assert route_calls[0]["path"] == "/api/v2/overview?project=/proj"
    for route in pd.ROUTES:
        assert m[f"dashboard_{route}_p50_ms"]["value"] == 10.0
        assert f"dashboard_{route}_p95_ms" in m
    assert m["dashboard_overview_bytes"]["value"] == 2048
    assert m["dashboard_overview_bytes"]["threshold"] == {"rel": 0.25, "abs": 512}
    assert m["dashboard_api_worst_p95_ms"]["value"] == 10.0
    assert m["dashboard_payload_max_kb"]["value"] == 4.0  # 4096 bytes (health)
    assert m["dashboard_payload_max_kb"]["unit"] == "KB"
    # SSE tick cost: sum of p50 over colony,todos,irc,health,improve = 5 * 10
    assert m["dashboard_sse_tick_cost_ms"]["value"] == 50.0


def test_api_percentiles_use_the_95th_rank(ctx, fake):
    ctx.n = 31
    fake.ramp = True  # sample i of a route takes i ms
    m = byname(pd.probe_dashboard_api(ctx))
    assert m["dashboard_overview_p50_ms"]["value"] == 15.0
    assert m["dashboard_overview_p95_ms"]["value"] == 28.0
    assert m["dashboard_api_worst_p95_ms"]["value"] == 28.0


def test_api_concurrency_samples_and_throughput(ctx, fake):
    m = byname(pd.probe_dashboard_api(ctx))
    n_conc = len([c for c in fake.instances[0].calls if c["path"].startswith("/api/v2/health") and c["token"]]) - 2
    assert n_conc == 8 * 8  # quick: 8 clients x 8 requests
    assert m["dashboard_conc8_health_p50_ms"]["detail"] == {"n": 64}
    assert m["dashboard_conc8_throughput_rps"]["value"] > 0
    assert m["dashboard_conc8_throughput_rps"]["direction"] == "higher"
    ctx.quick = False
    FakeDash.instances.clear()
    m = byname(pd.probe_dashboard_api(ctx))
    assert m["dashboard_conc8_health_p50_ms"]["detail"] == {"n": 96}


def test_api_non_200_route_is_skipped_triplet_and_excluded_from_aggregates(ctx, fake):
    fake.statuses = {"herd": 404, "overview": 404}
    m = byname(pd.probe_dashboard_api(ctx))
    for sfx in ("p50_ms", "p95_ms", "bytes"):
        s = m[f"dashboard_herd_{sfx}"]
        assert s["state"] == "skipped" and s["reason"] == "HTTP 404: route not served by this tree"
    assert m["dashboard_herd_bytes"]["unit"] == "bytes"
    assert "dashboard_overview_bytes" in m and m["dashboard_overview_bytes"]["state"] == "skipped"
    # payload max now comes from health (4096), not the skipped overview
    assert m["dashboard_payload_max_kb"]["value"] == 4.0
    # skipped routes contribute nothing to the SSE sum (herd is not an SSE topic): still 5 topics
    assert m["dashboard_sse_tick_cost_ms"]["value"] == 50.0


def test_api_all_routes_failing_omits_worst_p95_and_payload(ctx, fake):
    fake.statuses = {r: 500 for r in pd.ROUTES}
    m = byname(pd.probe_dashboard_api(ctx))
    assert "dashboard_api_worst_p95_ms" not in m
    assert "dashboard_payload_max_kb" not in m
    assert m["dashboard_sse_tick_cost_ms"]["value"] == 0


def test_api_auth_guard_requests_and_bypass_count(ctx, fake):
    m = byname(pd.probe_dashboard_api(ctx))
    assert m["dashboard_auth_bypass"]["value"] == 0
    assert m["dashboard_auth_bypass"]["unit"] == "of 6"
    calls = fake.instances[0].calls
    guards = [c for c in calls if c["host"] or c["origin"] or c["method"] == "POST" or (not c["token"] and ("irc" in c["path"] or "stream" in c["path"]))]
    assert any(c["host"] == "evil.example.com" for c in guards)
    assert any(c["origin"] == "http://evil.example.com" for c in guards)
    posts = [c for c in guards if c["method"] == "POST"]
    assert {c["path"] for c in posts} == {"/api/v2/colony/send", "/api/todo"}
    assert all(c["body"] == "{}" and c["token"] is False for c in posts)


def test_api_each_bypassed_guard_counts_once(ctx, fake):
    fake.guard_status = {"hostorigin": 200, "/api/v2/irc": 200, "/api/todo": 200}
    m = byname(pd.probe_dashboard_api(ctx))
    # host + origin + irc + todo = 4 bypasses (the stub answers POSTs by path for the other two)
    assert m["dashboard_auth_bypass"]["value"] == 4


def test_api_tokenless_open_routes_are_informational(ctx, fake):
    fake.open_routes = {"overview", "health", "prefs"}
    m = byname(pd.probe_dashboard_api(ctx))
    t = m["dashboard_tokenless_get_routes"]
    assert t["value"] == 3 and t["unit"] == f"of {len(pd.ROUTES)}" and t["direction"] == "info"


# --- probe_herd -----------------------------------------------------------------------------


def ps_table(*cmds):
    return {"rc": 0, "out": "".join(f"{100 + i} {c}\n" for i, c in enumerate(cmds)), "err": "", "ms": 1}


@pytest.fixture
def herd_ctx(ctx):
    (ctx.scripts / "atlas_dash_herd.py").write_text("")
    return ctx


def test_herd_absent_feature_skips_both(ctx):
    out = pd.probe_herd(ctx)
    assert [o["name"] for o in out] == ["herd_managed_instances", "herd_extra_instances"]
    assert all(o["state"] == "skipped" and "feature absent" in o["reason"] for o in out)


def test_herd_ps_failure_skips(herd_ctx, monkeypatch):
    monkeypatch.setattr(pd, "run", lambda *a, **k: {"rc": 1, "out": "", "err": "", "ms": 1})
    out = pd.probe_herd(herd_ctx)
    assert {o["reason"] for o in out} == {"ps failed"}


def test_herd_counts_only_bun_or_node_running_managed_ts(herd_ctx, monkeypatch):
    table = ps_table(
        "/usr/bin/bun run /x/managed.ts",
        "node --flag /y/managed.ts arg",
        "bun x managed.ts",
        "bun a b c managed.ts",          # managed.ts beyond argv[1:3]: not counted
        "python /z/managed.ts",          # wrong interpreter
        "bun managed.ts",                # argv[1] is managed.ts: counted
        "bun",                           # no args
        "vim managed.ts",
        "node /y/other.ts",
    )
    monkeypatch.setattr(pd, "run", lambda argv, **k: table if argv[0] == "ps" else None)
    m = byname(pd.probe_herd(herd_ctx))
    assert m["herd_managed_instances"]["value"] == 4
    assert m["herd_managed_instances"]["direction"] == "info"
    assert m["herd_extra_instances"]["value"] == 3
    assert m["herd_extra_instances"]["direction"] == "lower"


def test_herd_ps_blank_lines_are_skipped(herd_ctx, monkeypatch):
    monkeypatch.setattr(pd, "run", lambda *a, **k: {"rc": 0, "out": "1 bun /m/managed.ts\n\n   \n2 bash\n", "err": "", "ms": 1})
    assert byname(pd.probe_herd(herd_ctx))["herd_managed_instances"]["value"] == 1


def test_herd_zero_and_one_instance_have_no_extras(herd_ctx, monkeypatch):
    monkeypatch.setattr(pd, "run", lambda *a, **k: ps_table("bash"))
    assert byname(pd.probe_herd(herd_ctx))["herd_extra_instances"]["value"] == 0
    monkeypatch.setattr(pd, "run", lambda *a, **k: ps_table("bun /m/managed.ts"))
    m = byname(pd.probe_herd(herd_ctx))
    assert (m["herd_managed_instances"]["value"], m["herd_extra_instances"]["value"]) == (1, 0)


def test_herd_runs_ps_read_only(herd_ctx, monkeypatch):
    seen = {}
    monkeypatch.setattr(pd, "run", lambda argv, **k: seen.update(argv=argv, **k) or ps_table())
    pd.probe_herd(herd_ctx)
    assert seen["argv"] == ["ps", "-axo", "pid=,command="]
    assert seen["timeout"] == 10


def test_registry():
    assert [p[0] for p in pd.PROBES] == ["dashboard_api", "herd"]
    assert [p[3] for p in pd.PROBES] == [False, False]
    assert pd.ROUTES[0] == "overview" and len(pd.ROUTES) == 10
    assert pd.SSE_TOPICS == ("colony", "todos", "irc", "health", "improve")
    assert all(t in pd.ROUTES for t in pd.SSE_TOPICS)
