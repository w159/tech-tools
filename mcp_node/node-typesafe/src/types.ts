/** Which vendor endpoint a call actually resolved to. */
export type Provider = 'typesafe' | 'openrouter';

/** Caller-facing provider knob: an explicit provider, or 'auto' to resolve from configured keys. */
export type ProviderSetting = Provider | 'auto';

export interface TypeSafeClientConfig {
  /** Direct-provider API key, from console.typesafe.ai. */
  typesafeApiKey?: string;
  /** Direct-provider base URL. Defaults to https://api.typesafe.ai/v1. */
  typesafeBaseUrl?: string;
  /** OpenRouter API key, used only for the Jev Decisions path. */
  openrouterApiKey?: string;
  /** OpenRouter base URL. Defaults to https://openrouter.ai/api. */
  openrouterBaseUrl?: string;
  /** Optional OpenRouter attribution header (HTTP-Referer). Never required. */
  openrouterHttpReferer?: string;
  /** Optional OpenRouter attribution header (X-Title). Never required. */
  openrouterXTitle?: string;
  /** Explicit provider, or 'auto' (default) to resolve from configured keys. */
  provider?: ProviderSetting;
  /** Model id/slug override. Interpreted per-provider — see resolveModel(). */
  model?: string;
  /**
   * max_tokens budget sent on every OpenRouter Decisions call. Defaults to
   * 4096 (see DEFAULT_OPENROUTER_MAX_TOKENS in client.ts for why); clamped
   * to [1, 28800] (Jev's documented max_completion_tokens). Ignored on the
   * direct typesafe path - that API has no max_tokens parameter.
   */
  openrouterMaxTokens?: number;
  timeoutMs?: number;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** The `state` a Jev question is asked against: a string, JSON object, or JSON array. */
export type State = string | Record<string, JsonValue> | JsonValue[];

/** A single string|object|array instructions payload for one question. */
export type Instructions = string | Record<string, JsonValue> | JsonValue[];

/**
 * One criteria entry: a Choice option description, a Score level description, or a Noul
 * true/false description. Jev is trained to read structure, so an entry may be plain prose
 * or JSON (an object of labelled parts, or an array of things to check/compare).
 * See https://docs.typesafe.ai/primitives/advanced.md.
 */
export type CriteriaEntry = string | Record<string, JsonValue> | JsonValue[] | null;

export interface NoulQuestion {
  type: 'noul';
  instructions: Instructions;
  criteria?: { true?: CriteriaEntry; false?: CriteriaEntry };
}

export interface ChoiceQuestion {
  type: 'choice';
  instructions: Instructions;
  /** Option name -> description (prose, JSON, or null). Max 255 options. */
  criteria: Record<string, CriteriaEntry>;
}

export interface ScoreQuestion {
  type: 'score';
  instructions: Instructions;
  /** Level descriptions (prose or JSON), lowest to highest. 2-10 levels. */
  criteria: CriteriaEntry[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: 'score';
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export type Answers = Record<string, Answer>;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  /**
   * USD cost of the response, reported by the OpenRouter Decisions API (and
   * absent on the direct typesafe path). Jev bills input tokens only; output
   * tokens are free.
   */
  cost?: number;
}

export interface SystemOneRequest {
  state: State;
  questions: Questions;
  /** Overrides the client's configured/default model for this call only. */
  model?: string;
  /** Overrides the client's resolved provider for this call only. */
  provider?: Provider;
  /** Overrides the configured max_tokens for this OpenRouter call only. */
  maxTokens?: number;
}

export interface SystemOneResult {
  provider: Provider;
  model: string;
  answers: Answers;
  usage?: Usage;
}

export interface ModelInfo {
  name: string;
  description?: string;
  release_date?: string;
}

export interface ListModelsResult {
  provider: Provider;
  models: ModelInfo[];
  /** 'live' = fetched from GET /v1/models; 'static' = hardcoded (openrouter publishes no discovery endpoint). */
  source: 'live' | 'static';
}

export interface ProviderResolution {
  provider: Provider;
  reason: 'explicit' | 'typesafe-key-present' | 'openrouter-key-present';
}
