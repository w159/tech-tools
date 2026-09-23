import { TypeSafeApiError } from './errors.js';
import type { TypeSafeErrorCode } from './errors.js';
import type {
  Answers,
  ListModelsResult,
  ModelInfo,
  Provider,
  ProviderResolution,
  ProviderSetting,
  Questions,
  State,
  SystemOneRequest,
  SystemOneResult,
  TypeSafeClientConfig,
  Usage,
} from './types.js';

export const DEFAULT_TYPESAFE_BASE_URL = 'https://api.typesafe.ai/v1';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api';
export const DEFAULT_TYPESAFE_MODEL = 'jev-latest';
export const DEFAULT_OPENROUTER_MODEL = '~typesafe/jev-latest';
/**
 * max_tokens sent on every OpenRouter Decisions call. Jev is a decision model,
 * not a text generator: live Decisions responses carry 20-70 output tokens for
 * 1-20 typed questions, and output tokens are billed at $0 (verified against
 * the live endpoint metadata: completion price "0", max_completion_tokens
 * 28800, context_length 32000). OpenRouter's credit precheck nevertheless
 * reserves room for the model's FULL output budget when max_tokens is omitted
 * - for the ~typesafe/jev-latest alias that is a 65536-token reservation,
 * which any credit-limited key gets rejected on with HTTP 402 ("requires more
 * credits, or fewer max_tokens"). Sending a small explicit max_tokens both
 * matches what the model can actually produce and stops that precheck from
 * pricing in an output budget the model can never use. 4096 is ~2 orders of
 * magnitude above the largest observed answer payload and far below both
 * max_completion_tokens and the 32k context.
 */
export const DEFAULT_OPENROUTER_MAX_TOKENS = 4096;
/**
 * Hard ceiling for any caller-supplied max_tokens: Jev's documented
 * max_completion_tokens on OpenRouter is 28800 (context_length 32000). A
 * larger value would just be rejected or silently clamped by OpenRouter.
 */
export const MAX_OPENROUTER_MAX_TOKENS = 28800;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * OpenRouter publishes no Jev model-discovery endpoint (confirmed against
 * openrouter.ai/typesafe and openrouter.ai/~typesafe/jev-latest). This is the
 * full set of documented slugs; typesafe_list_models returns it verbatim with
 * source:"static" rather than a live lookup. Note the pinned slug carries no
 * leading "~" - that prefix is only on the always-latest alias.
 */
const OPENROUTER_STATIC_MODELS: ModelInfo[] = [
  {
    name: '~typesafe/jev-latest',
    description: 'Always-latest Jev alias (currently resolves to jev-1.13.0).',
  },
  {
    name: 'typesafe/jev-1.13',
    description:
      'Pinned Jev 1.13 release. No leading "~" - OpenRouter\'s pinned-version slug convention differs from the always-latest alias.',
  },
];

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function httpStatusToCode(status: number): TypeSafeErrorCode {
  if (status === 401 || status === 403) return 'FORBIDDEN';
  if (status === 402) return 'INSUFFICIENT_CREDITS';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 400 && status < 500) return 'INVALID_ARGS';
  return 'VENDOR_ERROR';
}

interface RequestSpec {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
}

/** Shared fetch + timeout + error-envelope wrapper for both provider endpoints. */
async function request(url: string, spec: RequestSpec, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: spec.method,
      headers: { 'content-type': 'application/json', ...spec.headers },
      body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new TypeSafeApiError(`TypeSafe API request to ${url} timed out after ${timeoutMs}ms`, {
        code: 'NETWORK_ERROR',
        status: 0,
      });
    }
    throw new TypeSafeApiError(`Network error calling ${url}: ${err instanceof Error ? err.message : String(err)}`, {
      code: 'NETWORK_ERROR',
      status: 0,
    });
  }
  clearTimeout(timer);

  const text = await res.text();
  if (!res.ok) {
    throw new TypeSafeApiError(`TypeSafe API request to ${url} failed: HTTP ${res.status}`, {
      code: httpStatusToCode(res.status),
      status: res.status,
      body: text.slice(0, 2000),
      retryAfter: res.headers.get('retry-after') ?? undefined,
    });
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeSafeApiError(`TypeSafe API returned a non-JSON response from ${url}`, {
      code: 'VENDOR_ERROR',
      status: res.status,
      body: text.slice(0, 2000),
    });
  }
}

export class TypeSafeClient {
  private readonly typesafeApiKey: string | undefined;
  private readonly typesafeBaseUrl: string;
  private readonly openrouterApiKey: string | undefined;
  private readonly openrouterBaseUrl: string;
  private readonly openrouterHttpReferer: string | undefined;
  private readonly openrouterXTitle: string | undefined;
  private readonly providerSetting: ProviderSetting;
  private readonly modelOverride: string | undefined;
  private readonly maxTokensOverride: number | undefined;
  private readonly timeoutMs: number;

  constructor(cfg: TypeSafeClientConfig = {}) {
    this.typesafeApiKey = cfg.typesafeApiKey || undefined;
    this.typesafeBaseUrl = stripTrailingSlash(cfg.typesafeBaseUrl || DEFAULT_TYPESAFE_BASE_URL);
    this.openrouterApiKey = cfg.openrouterApiKey || undefined;
    this.openrouterBaseUrl = stripTrailingSlash(cfg.openrouterBaseUrl || DEFAULT_OPENROUTER_BASE_URL);
    this.openrouterHttpReferer = cfg.openrouterHttpReferer || undefined;
    this.openrouterXTitle = cfg.openrouterXTitle || undefined;
    this.providerSetting = cfg.provider ?? 'auto';
    this.modelOverride = cfg.model || undefined;
    this.maxTokensOverride = this.sanitizeMaxTokens(cfg.openrouterMaxTokens);
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Provider auto-resolution contract:
   *   1. An explicit "typesafe" or "openrouter" setting (constructor config or
   *      the `override` argument) wins; its required key must be present or
   *      this throws MISSING_CREDENTIALS naming exactly that env var.
   *   2. Else TYPESAFE_API_KEY present -> "typesafe".
   *   3. Else OPENROUTER_API_KEY present -> "openrouter".
   *   4. Else throws MISSING_CREDENTIALS naming BOTH options. The real-world
   *      case this exists for is "console.typesafe.ai is down, I only have an
   *      OpenRouter key" - OpenRouter must read as a first-class, fully
   *      supported answer here, never an afterthought buried in a generic
   *      error.
   */
  resolveProvider(override?: ProviderSetting): ProviderResolution {
    const setting = override ?? this.providerSetting;
    if (setting === 'typesafe' || setting === 'openrouter') {
      if (setting === 'typesafe' && !this.typesafeApiKey) {
        throw new TypeSafeApiError(
          'TYPESAFE_PROVIDER is set to "typesafe" but TYPESAFE_API_KEY is not configured.',
          { code: 'MISSING_CREDENTIALS', status: 0 }
        );
      }
      if (setting === 'openrouter' && !this.openrouterApiKey) {
        throw new TypeSafeApiError(
          'TYPESAFE_PROVIDER is set to "openrouter" but OPENROUTER_API_KEY is not configured.',
          { code: 'MISSING_CREDENTIALS', status: 0 }
        );
      }
      return { provider: setting, reason: 'explicit' };
    }
    if (this.typesafeApiKey) return { provider: 'typesafe', reason: 'typesafe-key-present' };
    if (this.openrouterApiKey) return { provider: 'openrouter', reason: 'openrouter-key-present' };
    throw new TypeSafeApiError(
      'No TypeSafe provider could be resolved. Set TYPESAFE_API_KEY (from console.typesafe.ai) or ' +
        'OPENROUTER_API_KEY (from openrouter.ai) - OpenRouter is a fully supported standalone path, not ' +
        'a fallback, for when console.typesafe.ai is unavailable.',
      { code: 'MISSING_CREDENTIALS', status: 0 }
    );
  }

  /** Resolved base URL for a provider - never throws, useful for status reporting. */
  resolveBaseUrl(provider: Provider): string {
    return provider === 'typesafe' ? this.typesafeBaseUrl : this.openrouterBaseUrl;
  }

  /**
   * Model defaulting: "typesafe" defaults to jev-latest; "openrouter" defaults
   * to ~typesafe/jev-latest. A configured override is used verbatim for
   * "typesafe". For "openrouter", an override containing no "/" (e.g. a bare
   * "jev-latest" pasted in from the direct-API docs by mistake) is
   * auto-prefixed with "~typesafe/" as a convenience.
   */
  resolveModel(provider: Provider, override?: string): string {
    const configured = override ?? this.modelOverride;
    if (provider === 'typesafe') return configured || DEFAULT_TYPESAFE_MODEL;
    if (!configured) return DEFAULT_OPENROUTER_MODEL;
    return configured.includes('/') ? configured : `~typesafe/${configured}`;
  }

  /**
   * The max_tokens value sent on every OpenRouter Decisions call. The per-call
   * override wins over the configured one; both fall back to
   * DEFAULT_OPENROUTER_MAX_TOKENS. Values are clamped into
   * [1, MAX_OPENROUTER_MAX_TOKENS] because Jev's OpenRouter endpoint metadata
   * reports max_completion_tokens 28800 - anything larger is not a setting
   * the model can honor. Invalid input (NaN, fractional, non-positive) is
   * treated as unset, never thrown: this is a budget knob, not a contract.
   */
  resolveMaxTokens(override?: number): number {
    const raw = override ?? this.maxTokensOverride ?? DEFAULT_OPENROUTER_MAX_TOKENS;
    const n = Math.floor(raw);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_OPENROUTER_MAX_TOKENS;
    return Math.min(n, MAX_OPENROUTER_MAX_TOKENS);
  }

  private sanitizeMaxTokens(raw: number | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const n = Math.floor(raw);
    if (!Number.isFinite(n) || n < 1) return undefined;
    return Math.min(n, MAX_OPENROUTER_MAX_TOKENS);
  }

  /** Ask Jev System One 1-20 typed questions about a state. */
  async systemOne(req: SystemOneRequest): Promise<SystemOneResult> {
    const { provider } = this.resolveProvider(req.provider);
    const model = this.resolveModel(provider, req.model);
    return provider === 'typesafe'
      ? this.systemOneTypesafe(req.state, req.questions, model)
      : this.systemOneOpenRouter(req.state, req.questions, model, this.resolveMaxTokens(req.maxTokens));
  }

  private async systemOneTypesafe(state: State, questions: Questions, model: string): Promise<SystemOneResult> {
    if (!this.typesafeApiKey) {
      throw new TypeSafeApiError('TYPESAFE_API_KEY is not configured.', { code: 'MISSING_CREDENTIALS', status: 0 });
    }
    const url = `${this.typesafeBaseUrl}/systemone`;
    const body = (await request(
      url,
      { method: 'POST', headers: { authorization: `Bearer ${this.typesafeApiKey}` }, body: { state, model, questions } },
      this.timeoutMs
    )) as { model?: string; answers?: Answers; usage?: Usage };
    return {
      provider: 'typesafe',
      model: body.model ?? model,
      answers: body.answers ?? {},
      usage: body.usage,
    };
  }

  /**
   * OpenRouter's Decisions API, POST /api/alpha/decisions. Verified against
   * OpenRouter's published OpenAPI schema and live endpoint metadata:
   *
   * - Request body: {model, state, questions} required; max_tokens is not a
   *   documented DecisionsRequest property, but OpenRouter's documented
   *   max_tokens behavior ("upper limit for tokens the model can generate")
   *   and its credit precheck both apply: omitted max_tokens makes the
   *   precheck reserve the model's full output budget, which for the
   *   ~typesafe/jev-latest alias is 65536 tokens - more than many keys can
   *   afford - producing HTTP 402 "requires more credits, or fewer
   *   max_tokens". We therefore always send an explicit, small max_tokens.
   * - Jev endpoint metadata (typesafe/jev-1.13): context_length 32000,
   *   max_completion_tokens 28800, supported_parameters [] (no sampling
   *   parameters), completion price $0. Output tokens are free; only input
   *   tokens are billed.
   * - Response envelope: flat {id, model, provider, answers, usage:{cost,
   *   input_tokens, output_tokens}} per the DecisionsResponse schema and the
   *   live examples in the docs. The nested `decision` fallback below is kept
   *   only as defensive cover for the OpenRouter SDK wrapper shape; it can be
   *   removed once a live call confirms the flat shape holds.
   */
  private async systemOneOpenRouter(
    state: State,
    questions: Questions,
    model: string,
    maxTokens: number
  ): Promise<SystemOneResult> {
    if (!this.openrouterApiKey) {
      throw new TypeSafeApiError('OPENROUTER_API_KEY is not configured.', { code: 'MISSING_CREDENTIALS', status: 0 });
    }
    const url = `${this.openrouterBaseUrl}/alpha/decisions`;
    const headers: Record<string, string> = { authorization: `Bearer ${this.openrouterApiKey}` };
    if (this.openrouterHttpReferer) headers['http-referer'] = this.openrouterHttpReferer;
    if (this.openrouterXTitle) headers['x-title'] = this.openrouterXTitle;

    const body = (await request(
      url,
      { method: 'POST', headers, body: { model, state, questions, max_tokens: maxTokens } },
      this.timeoutMs
    )) as Record<string, unknown>;
    const nested = (body.decision ?? {}) as Record<string, unknown>;
    const answers = (body.answers ?? nested.answers ?? {}) as Answers;
    const usage = (body.usage ?? nested.usage) as Usage | undefined;
    const resolvedModel = (body.model ?? nested.model ?? model) as string;
    return { provider: 'openrouter', model: resolvedModel, answers, usage };
  }

  /**
   * List available Jev models for the resolved provider. Direct does a live
   * GET /v1/models; openrouter has no documented discovery endpoint for this
   * path, so it returns the static two-entry list above.
   */
  async listModels(opts: { provider?: Provider } = {}): Promise<ListModelsResult> {
    const { provider } = this.resolveProvider(opts.provider);
    if (provider === 'openrouter') {
      return { provider, models: OPENROUTER_STATIC_MODELS, source: 'static' };
    }
    if (!this.typesafeApiKey) {
      throw new TypeSafeApiError('TYPESAFE_API_KEY is not configured.', { code: 'MISSING_CREDENTIALS', status: 0 });
    }
    const url = `${this.typesafeBaseUrl}/models`;
    const body = (await request(
      url,
      { method: 'GET', headers: { authorization: `Bearer ${this.typesafeApiKey}` } },
      this.timeoutMs
    )) as { models?: ModelInfo[] };
    return { provider, models: body.models ?? [], source: 'live' };
  }
}
