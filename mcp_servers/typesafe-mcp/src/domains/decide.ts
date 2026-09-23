import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Provider, Question, Questions } from 'node-typesafe';
import { DEFAULT_OPENROUTER_MAX_TOKENS, MAX_OPENROUTER_MAX_TOKENS } from 'node-typesafe';
import { readOnlyTool, shapeRaw, toolError, typesafeToolError, type CallToolResult } from './_helpers.js';
import { getClient } from '../utils/client.js';

const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 20;
const VALID_TYPES = new Set(['noul', 'choice', 'score']);
const VALID_PROVIDERS = new Set(['typesafe', 'openrouter']);

export const decideTool: Tool = readOnlyTool({
  name: 'typesafe_decide',
  description:
    "Ask TypeSafe's Jev System One model 1-20 typed questions about a state. Jev is a judgment-" +
    'primitive model, not a chat/coding LLM: it answers typed noul (yes/no probability), choice ' +
    '(pick one of up to 255 named options), or score (2-10 ordered levels) questions and returns ' +
    'typed answers with probabilities and confidence - never free text. Use it for routing, ' +
    'scoring, and verification decisions. Model parameters: 32k-token context (64k request ' +
    'total, 32k for state plus the longest single question), output is a compact typed payload ' +
    '(tens of tokens), no sampling parameters supported. The openrouter provider always sends ' +
    'max_tokens (default 4096, max 28800) so OpenRouter\u2019s credit precheck does not reserve ' +
    'the model\u2019s full 65536-token output budget against your key. Resolves the typesafe ' +
    '(console.typesafe.ai) or openrouter (openrouter.ai) provider automatically from configured ' +
    'credentials unless overridden with provider.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      state: {
        description:
          'The state to judge: a string, JSON object, or JSON array. This is the only thing Jev ' +
          'reasons about - include everything each question needs.',
      },
      questions: {
        type: 'object' as const,
        description:
          `${MIN_QUESTIONS}-${MAX_QUESTIONS} entries keyed by an id you choose. Each value is one of: ` +
          '{type:"noul",instructions,criteria?:{true?,false?}} (yes/no probability) | ' +
          '{type:"choice",instructions,criteria:{option:description|null,...}} (max 255 options) | ' +
          '{type:"score",instructions,criteria:[levelDescription,...]} (2-10 levels, lowest to highest). ' +
          'Jev reads structure: instructions and every criteria description may be prose OR JSON ' +
          '(an object of labelled parts, or an array of things to check/compare) instead of a string. ' +
          'Batch every question you might need into one call - they are evaluated in parallel, so ' +
          'extra questions cost far less than extra calls.',
        minProperties: MIN_QUESTIONS,
        maxProperties: MAX_QUESTIONS,
      },
      model: {
        type: 'string' as const,
        description:
          'Optional model override for this call only. For provider "typesafe" used verbatim ' +
          '(default jev-latest); for "openrouter" a bare slug with no "/" is auto-prefixed with ' +
          '"~typesafe/" (default ~typesafe/jev-latest).',
      },
      max_tokens: {
        type: 'integer' as const,
        minimum: 1,
        maximum: MAX_OPENROUTER_MAX_TOKENS,
        description:
          `Optional OpenRouter-only output budget for this call, tokens (default ${DEFAULT_OPENROUTER_MAX_TOKENS}, ` +
          `hard max ${MAX_OPENROUTER_MAX_TOKENS} - Jev\u2019s documented max_completion_tokens). Jev answers are ` +
          'tens of tokens, so the default already far exceeds any real answer; lower it only to shrink ' +
          'OpenRouter\u2019s credit precheck reservation. Ignored on the typesafe provider (that API has ' +
          'no max_tokens parameter).',
      },
      provider: {
        type: 'string' as const,
        enum: ['typesafe', 'openrouter'],
        description: 'Optional provider override for this call only, bypassing auto-resolution.',
      },
    },
    required: ['state', 'questions'],
  },
});

interface ValidationOk {
  ok: true;
  value: Questions;
}
interface ValidationFail {
  ok: false;
  message: string;
}

function validateQuestions(questions: unknown): ValidationOk | ValidationFail {
  if (typeof questions !== 'object' || questions === null || Array.isArray(questions)) {
    return { ok: false, message: 'questions must be an object mapping question id -> question.' };
  }
  const entries = Object.entries(questions as Record<string, unknown>);
  if (entries.length < MIN_QUESTIONS || entries.length > MAX_QUESTIONS) {
    return {
      ok: false,
      message: `questions must have between ${MIN_QUESTIONS} and ${MAX_QUESTIONS} entries; got ${entries.length}.`,
    };
  }
  for (const [id, raw] of entries) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, message: `question "${id}" must be an object.` };
    }
    const q = raw as Record<string, unknown>;
    if (typeof q.type !== 'string' || !VALID_TYPES.has(q.type)) {
      return { ok: false, message: `question "${id}".type must be one of noul, choice, score.` };
    }
    if (q.instructions === undefined || q.instructions === null) {
      return { ok: false, message: `question "${id}" is missing instructions.` };
    }
    // Every criteria *description* may be a string, JSON object, JSON array, or null - Jev is
    // trained to read structure. Only the criteria container's shape and size are validated here.
    if (q.type === 'choice') {
      if (typeof q.criteria !== 'object' || q.criteria === null || Array.isArray(q.criteria)) {
        return {
          ok: false,
          message: `question "${id}" (choice) requires criteria: an object mapping option name -> description, where a description is prose, JSON, or null.`,
        };
      }
      const optionCount = Object.keys(q.criteria as object).length;
      if (optionCount < 1 || optionCount > 255) {
        return { ok: false, message: `question "${id}" (choice) criteria must have 1-255 options; got ${optionCount}.` };
      }
    } else if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10) {
        return { ok: false, message: `question "${id}" (score) requires criteria: an array of 2-10 level descriptions (each prose or JSON), lowest to highest.` };
      }
    } else if (q.criteria !== undefined) {
      // noul: criteria is optional, but if present must be a plain object.
      if (typeof q.criteria !== 'object' || q.criteria === null || Array.isArray(q.criteria)) {
        return { ok: false, message: `question "${id}" (noul) criteria, if present, must be an object with optional true/false descriptions (each prose or JSON).` };
      }
    }
  }
  return { ok: true, value: questions as Record<string, Question> };
}

export async function handleDecide(args: Record<string, unknown>): Promise<CallToolResult> {
  if (args.state === undefined || args.state === null) {
    return toolError('INVALID_ARGS', 'state is required: a string, JSON object, or JSON array.');
  }
  const validated = validateQuestions(args.questions);
  if (!validated.ok) {
    return toolError('INVALID_ARGS', validated.message);
  }
  const provider = args.provider === undefined ? undefined : (VALID_PROVIDERS.has(args.provider as string) ? (args.provider as Provider) : undefined);
  if (args.provider !== undefined && provider === undefined) {
    return toolError('INVALID_ARGS', 'provider, if set, must be "typesafe" or "openrouter".');
  }
  let maxTokens: number | undefined;
  if (args.max_tokens !== undefined) {
    const n = Number(args.max_tokens);
    if (!Number.isInteger(n) || n < 1 || n > MAX_OPENROUTER_MAX_TOKENS) {
      return toolError(
        'INVALID_ARGS',
        `max_tokens, if set, must be an integer between 1 and ${MAX_OPENROUTER_MAX_TOKENS} (Jev's documented max_completion_tokens).`
      );
    }
    maxTokens = n;
  }

  try {
    const client = getClient();
    const result = await client.systemOne({
      state: args.state as never,
      questions: validated.value,
      model: typeof args.model === 'string' ? args.model : undefined,
      provider,
      maxTokens,
    });
    return shapeRaw(result);
  } catch (err) {
    return typesafeToolError('typesafe_decide', err, {
      hint:
        err instanceof Error && (err as { code?: unknown }).code === 'INSUFFICIENT_CREDITS'
          ? 'OpenRouter rejected the call on credits. The connector sends a small explicit max_tokens ' +
            `(default ${DEFAULT_OPENROUTER_MAX_TOKENS}) so its credit precheck does not reserve the ` +
            "model's full output budget; check the key's monthly limit at openrouter.ai or top up credits."
          : 'Call typesafe_status to check which provider and model resolved for this call.',
    });
  }
}
