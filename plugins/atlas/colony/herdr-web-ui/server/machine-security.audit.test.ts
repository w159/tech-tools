import { describe, expect, test } from "bun:test";
import { canSendSecret } from "./machine-security.ts";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe("canSendSecret trusts x-forwarded-proto only behind a real proxy", () => {
  test("direct plain http from a LAN host with a forged header is refused", () => {
    expect(canSendSecret(req("http://192.168.1.20:7777/api/machines", { "x-forwarded-proto": "https" }))).toBe(false);
    expect(canSendSecret(req("http://192.168.1.20:7777/api/machines", { host: "192.168.1.20:7777", "x-forwarded-proto": "https" }))).toBe(false);
  });
  test("an https url is allowed", () => {
    expect(canSendSecret(req("https://app.example/api/machines"))).toBe(true);
  });
  test("loopback is allowed, with or without a forged header", () => {
    expect(canSendSecret(req("http://127.0.0.1:7777/api/machines"))).toBe(true);
    expect(canSendSecret(req("http://localhost:7777/api/machines", { "x-forwarded-proto": "https" }))).toBe(true);
  });
  test("a request with proxy evidence and x-forwarded-proto https is allowed", () => {
    expect(canSendSecret(req("http://pc.tail.ts.net/api/machines", { "x-forwarded-proto": "https", "x-forwarded-for": "100.64.0.2" }))).toBe(true);
  });
});
