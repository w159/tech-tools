"""Dashboard + herd probes: an isolated dashboard on a free loopback port over a COPY /
synthetic DB. Measures every /api/v2 GET route, 8-client concurrency, auth guards, SSE
tick cost and herd endpoint latency. Only the dashboard we start is ever stopped."""

import http.client
import json
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from . import core
from .core import metric, run, skipped, timing
from .probe_hooks import CMD

ROUTES = [
    "overview",
    "projects",
    "health",
    "activity",
    "improve",
    "todos",
    "irc",
    "colony",
    "herd",
    "prefs",
]
SSE_TOPICS = ("colony", "todos", "irc", "health", "improve")


class Dash:
    def __init__(self, ctx):
        self.ctx = ctx
        self.env, self.atlas, self.home = core.iso_env(ctx, "dash")
        self.root = ctx.sub("dash") / "proj"
        core.make_project(self.root, with_git=False)
        self.port = core.free_port()
        self.proc = None
        self.token = None
        self.db_info = None

    def start(self):
        self.db_info = core.seed_db(self.ctx, self.atlas / "atlas.db", self.root)
        log = open(self.ctx.sub("dash") / "dash.log", "w")
        self.proc = subprocess.Popen(
            [
                self.ctx.py,
                str(self.ctx.scripts / "atlas_dashboard.py"),
                "serve",
                "--foreground",
                "--host",
                "127.0.0.1",
                "--port",
                str(self.port),
            ],
            env={**self.env, "ATLAS_DASHBOARD_PORT": str(self.port)},
            stdout=log,
            stderr=log,
            cwd=str(self.ctx.sub("dash")),
        )
        self.ctx.cleanups.append(self.stop)
        for _ in range(100):
            if self.proc.poll() is not None:
                raise RuntimeError(
                    "dashboard exited: "
                    + (self.ctx.sub("dash") / "dash.log").read_text()[-300:]
                )
            try:
                st, _b, _ms = self.get("/api/health", token=False)
                if st == 200:
                    break
            except OSError:
                pass
            time.sleep(0.15)
        else:
            raise RuntimeError("dashboard did not become healthy in 15s")
        st, body, _ = self.get("/", token=False)
        m = re.search(rb'name="atlas-token" content="([^"]+)"', body)
        if not m:
            raise RuntimeError(f"no token in index (status {st})")
        self.token = m.group(1).decode()

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def get(self, path, token=True, host=None, origin=None, method="GET", body=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        h = {"Host": host or f"127.0.0.1:{self.port}"}
        if token and self.token:
            h["X-Atlas-Token"] = self.token
        if origin:
            h["Origin"] = origin
        if body is not None:
            h["Content-Type"] = "application/json"
        t = time.perf_counter()
        try:
            c.request(method, path, body=body, headers=h)
            r = c.getresponse()
            data = r.read()
            return r.status, data, (time.perf_counter() - t) * 1000
        finally:
            c.close()


def probe_dashboard_api(ctx):
    cmd = CMD + "dashboard_api"
    names = ["dashboard_up", "dashboard_api_worst_p95_ms"]
    d = Dash(ctx)
    try:
        d.start()
    except Exception as e:  # noqa: BLE001
        d.stop()
        return [
            skipped(
                n, f"dashboard would not start: {e}", group="dashboard", state="error"
            )
            for n in names
        ]
    try:
        out = [
            metric(
                "dashboard_up",
                1,
                "bool",
                "higher",
                cmd=cmd,
                group="dashboard",
                note=f"DB: {d.db_info['kind']} ({d.db_info['messages']} messages)",
            )
        ]
        q = f"?project={d.root}"
        n = ctx.n
        p95s, sizes, p50 = [], [], {}
        for route in ROUTES:
            path = f"/api/v2/{route}{q}"
            samples, status = [], None
            for _ in range(n):
                status, body, ms = d.get(path)
                samples.append(ms)
            if status != 200:
                out += [
                    skipped(
                        f"dashboard_{route}_{sfx}",
                        f"HTTP {status}: route not served by this tree",
                        unit,
                        cmd=cmd,
                        group="dashboard",
                    )
                    for sfx, unit in (
                        ("p50_ms", "ms"),
                        ("p95_ms", "ms"),
                        ("bytes", "bytes"),
                    )
                ]
                continue
            out += core.latency_metrics(f"dashboard_{route}", samples, "dashboard", cmd)
            out.append(
                metric(
                    f"dashboard_{route}_bytes",
                    len(body),
                    "bytes",
                    "lower",
                    {"rel": 0.25, "abs": 512},
                    cmd,
                    "dashboard",
                    False,
                )
            )
            p95s.append(core.pct(samples, 95))
            sizes.append(len(body))
            p50[route] = core.pct(samples, 50)
        if p95s:
            out.append(
                timing("dashboard_api_worst_p95_ms", max(p95s), cmd, "dashboard")
            )
            out.append(
                metric(
                    "dashboard_payload_max_kb",
                    max(sizes) / 1024,
                    "KB",
                    "lower",
                    {"rel": 0.25, "abs": 5},
                    cmd,
                    "dashboard",
                    False,
                )
            )
        out.append(
            timing(
                "dashboard_sse_tick_cost_ms",
                sum(p50.get(t, 0) for t in SSE_TOPICS),
                cmd,
                "dashboard",
                note="sum of the SSE topic route p50s: CPU spent per open client per 5 s tick",
            )
        )
        # 8 concurrent clients on /health
        lat, t0 = [], time.perf_counter()
        lock = threading.Lock()

        def client(_i):
            for _ in range(8 if ctx.quick else 12):
                _s, _b, ms = d.get(f"/api/v2/health{q}")
                with lock:
                    lat.append(ms)

        with ThreadPoolExecutor(8) as ex:
            list(ex.map(client, range(8)))
        wall = time.perf_counter() - t0
        out += core.latency_metrics("dashboard_conc8_health", lat, "dashboard", cmd)
        out.append(
            metric(
                "dashboard_conc8_throughput_rps",
                len(lat) / wall,
                "req/s",
                "higher",
                {"rel": 0.25, "abs": 0.5},
                cmd,
                "dashboard",
                False,
            )
        )
        # auth guards. By design only mutations and sensitive GETs (irc, colony capture/agent,
        # stream, transcripts) need the token; Host and Origin are checked on everything.
        guards = (
            ("GET", "/api/v2/overview" + q, {"host": "evil.example.com"}),
            ("GET", "/api/v2/overview" + q, {"origin": "http://evil.example.com"}),
            ("GET", "/api/v2/irc" + q, {"token": False}),
            ("GET", "/api/v2/stream" + q, {"token": False}),
            ("POST", "/api/v2/colony/send", {"token": False, "body": "{}"}),
            ("POST", "/api/todo", {"token": False, "body": "{}"}),
        )
        bypass = 0
        for method, path, kw in guards:
            st, _b, _ms = d.get(path, method=method, **kw)
            bypass += st == 200
        out.append(
            metric(
                "dashboard_auth_bypass",
                bypass,
                f"of {len(guards)}",
                "lower",
                cmd=cmd,
                group="dashboard",
                note="requests that must be refused (bad Host/Origin, missing token on sensitive/mutating routes) but got 200",
            )
        )
        open_routes = 0
        for route in ROUTES:
            st, _b, _ms = d.get(f"/api/v2/{route}{q}", token=False)
            open_routes += st == 200
        out.append(
            metric(
                "dashboard_tokenless_get_routes",
                open_routes,
                f"of {len(ROUTES)}",
                "info",
                cmd=cmd,
                group="dashboard",
                note="GET routes that answer 200 with no token (exposure surface, informational)",
            )
        )
        return out
    finally:
        d.stop()


def probe_herd(ctx):
    cmd = CMD + "herd"
    names = ["herd_managed_instances", "herd_extra_instances"]
    if not (ctx.scripts / "atlas_dash_herd.py").exists():
        return [
            skipped(
                n,
                "feature absent: scripts/atlas_dash_herd.py (n/a for this tree)",
                "processes",
                group="herd",
            )
            for n in names
        ]
    # read-only look at the process table: how many herdr web-ui managed.ts instances exist.
    ps = run(["ps", "-axo", "pid=,command="], timeout=10)
    if ps["rc"] != 0:
        return [skipped(n, "ps failed", "processes", group="herd") for n in names]
    count = 0
    for ln in ps["out"].splitlines():
        argv = (ln.strip().split(None, 1) + [""])[1].split()
        if (
            len(argv) > 1
            and argv[0].rsplit("/", 1)[-1] in ("bun", "node")
            and any(a.endswith("managed.ts") for a in argv[1:3])
        ):
            count += 1
    out = [
        metric(
            "herd_managed_instances",
            count,
            "processes",
            "info",
            cmd=cmd,
            group="herd",
            note="read-only ps count of live `bun|node ...managed.ts`; nothing is started or killed",
        ),
        metric(
            "herd_extra_instances",
            max(0, count - 1),
            "processes",
            "lower",
            cmd=cmd,
            group="herd",
        ),
    ]
    return out


PROBES = [
    (
        "dashboard_api",
        probe_dashboard_api,
        ["dashboard_up", "dashboard_api_worst_p95_ms"],
        False,
    ),
    ("herd", probe_herd, ["herd_managed_instances"], False),
]
