// The handler is driven through a handler-capturing fake `pi`; provider payload shapes
// mirror what the omp transports hand to `onPayload` (pi-ai providers/*): anthropic
// `max_tokens`, openai-completions `max_tokens` | `max_completion_tokens`, openai-responses
// `max_output_tokens`, ollama `options.num_predict`.
import { expect, test } from "bun:test";
import { ATLAS_WORKER_MAX_TOKENS_DEFAULT, registerWorkerBudget } from "./workers";

type Handler = (event: { payload: unknown }, ctx: { agent: { kind: "main" | "sub" } }) => unknown;
type Fields = Record<string, unknown>;

function harness(env?: Record<string, string | undefined>) {
	const handlers: Record<string, Handler[]> = {};
	const api = {
		on: (name: string, handler: Handler) => {
			(handlers[name] ??= []).push(handler);
		},
	};
	registerWorkerBudget(api as never, { env: env ?? {} });
	const clamp = (payload: unknown, kind: "main" | "sub" = "sub") =>
		handlers.before_provider_request[0]({ payload }, { agent: { kind } });
	return { clamp, handlers };
}

test("default cap is 32000 and only before_provider_request is hooked", () => {
	const { handlers } = harness();
	expect(ATLAS_WORKER_MAX_TOKENS_DEFAULT).toBe(32000);
	expect(Object.keys(handlers)).toEqual(["before_provider_request"]);
});

test("anthropic: lowers max_tokens in a subagent and returns the payload object itself", () => {
	const { clamp } = harness();
	const messages = [{ role: "user", content: "hi" }];
	const payload = { model: "claude-x", max_tokens: 131072, messages };
	const out = clamp(payload);
	expect(out).toBe(payload);
	expect(payload.max_tokens).toBe(32000);
	expect(payload.messages).toBe(messages);
});

test("openai-compatible and responses: clamps whichever output field the payload carries", () => {
	const { clamp } = harness();
	for (const field of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) {
		const payload: Fields = { model: "m", [field]: 131072 };
		expect(clamp(payload)).toBe(payload);
		expect(payload[field]).toBe(32000);
	}
});

test("ollama: lowers options.num_predict, keeps sibling options, never fabricates options", () => {
	const { clamp } = harness();
	const payload = { model: "llama", options: { num_predict: 100_000, temperature: 0.2 }, stream: true };
	expect(clamp(payload)).toBe(payload);
	expect(payload.options).toEqual({ num_predict: 32000, temperature: 0.2 });

	const bare = { model: "llama", messages: [], stream: true };
	expect(clamp(bare)).toBeUndefined();
	expect("options" in bare).toBe(false);
});

test("never raises: at-cap, below-cap and absent token fields yield no replacement", () => {
	const { clamp } = harness();
	const atCap = { model: "m", max_tokens: 32000 };
	const below = { model: "m", max_tokens: 29951, options: { num_predict: 10 } };
	expect(clamp(atCap)).toBeUndefined();
	expect(clamp(below)).toBeUndefined();
	expect(clamp({ model: "m", messages: [] })).toBeUndefined();
	expect(atCap.max_tokens).toBe(32000);
	expect(below.max_tokens).toBe(29951);
	expect(below.options.num_predict).toBe(10);
});

test("unknown payloads are untouched", () => {
	const { clamp } = harness();
	const gemini = { model: "g", generationConfig: { maxOutputTokens: 131072 } };
	expect(clamp(gemini)).toBeUndefined();
	expect(gemini.generationConfig.maxOutputTokens).toBe(131072);
	expect(clamp("raw body")).toBeUndefined();
	expect(clamp(null)).toBeUndefined();
	expect(clamp([{ max_tokens: 131072 }])).toBeUndefined();
	const stringy = { model: "m", max_tokens: "131072" };
	expect(clamp(stringy)).toBeUndefined();
	expect(stringy.max_tokens).toBe("131072");
});

test("anthropic budget thinking: never lowers max_tokens to or under thinking.budget_tokens (provider 400)", () => {
	const { clamp } = harness();
	const payload = { model: "m", max_tokens: 131072, thinking: { type: "enabled", budget_tokens: 40_000 } };
	expect(clamp(payload)).toBeUndefined();
	expect(payload.max_tokens).toBe(131072);

	const roomy = { model: "m", max_tokens: 131072, thinking: { type: "enabled", budget_tokens: 8_000 } };
	expect(clamp(roomy)).toBe(roomy);
	expect(roomy.max_tokens).toBe(32000);
});

test("only subagent sessions are clamped", () => {
	const { clamp } = harness();
	const payload = { model: "m", max_tokens: 131072 };
	expect(clamp(payload, "main")).toBeUndefined();
	expect(payload.max_tokens).toBe(131072);
});

test("ATLAS_WORKER_MAX_TOKENS overrides the cap; invalid or non-positive values fall back to 32000", () => {
	const small = harness({ ATLAS_WORKER_MAX_TOKENS: "1024" });
	const payload = { max_tokens: 131072 };
	small.clamp(payload);
	expect(payload.max_tokens).toBe(1024);

	for (const invalid of ["abc", "0", "-5", "", "  ", "1e400x"]) {
		const h = harness({ ATLAS_WORKER_MAX_TOKENS: invalid });
		const p = { max_tokens: 131072 };
		h.clamp(p);
		expect(p.max_tokens).toBe(32000);
	}
});

test("fails open: an unreadable payload leaves the request alone", () => {
	const { clamp } = harness();
	const payload = {};
	Object.defineProperty(payload, "max_tokens", {
		enumerable: true,
		get() {
			throw new Error("boom");
		},
	});
	expect(clamp(payload)).toBeUndefined();
});
