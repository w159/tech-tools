// Minimal cookie jar for driving a browser-style redirect chain with fetch.
interface Cookie {
  name: string;
  value: string;
  path: string;
}

export class CookieJar {
  private cookies: Cookie[] = [];

  store(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      let path = "/";
      let expired = value === "";
      for (const a of attrs) {
        const [k, v = ""] = a.split("=");
        const key = k!.toLowerCase();
        if (key === "path") path = v;
        if (key === "max-age" && Number(v) <= 0) expired = true;
        if (key === "expires" && Date.parse(v) <= Date.now()) expired = true;
      }
      this.cookies = this.cookies.filter((c) => !(c.name === name && c.path === path));
      if (!expired) this.cookies.push({ name, value, path });
    }
  }

  headerFor(url: URL): string {
    return this.cookies
      .filter((c) => url.pathname === c.path || url.pathname.startsWith(c.path.endsWith("/") ? c.path : `${c.path}/`))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }
}
