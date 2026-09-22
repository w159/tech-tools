import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Provider, Question, Questions } from 'node-typesafe';
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
    'scoring, and verification decisions. Resolves the typesafe (console.typesafe.ai) or ' +
    'openrouter (openrouter.ai) provider automatically from configured credentials unless ' +
    'overridden with provider. Context budget: 64k tokens total / 32k for state plus the longest ' +
    'single question (not enforced client-side).',
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
          '{type:"score",instructions,criteria:[levelDescription,...]} (2-10 levels, lowest to highest).',
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
    if (q.type === 'choice') {
      if (typeof q.criteria !== 'object' || q.criteria === null || Array.isArray(q.criteria)) {
        return {
          ok: false,
          message: `question "${id}" (choice) requires criteria: an object mapping option name -> description|null.`,
        };
      }
      const optionCount = Object.keys(q.criteria as object).length;
      if (optionCount < 1 || optionCount > 255) {
        return { ok: false, message: `question "${id}" (choice) criteria must have 1-255 options; got ${optionCount}.` };
      }
    } else if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10) {
        return { ok: false, message: `question "${id}" (score) requires criteria: an array of 2-10 level descriptions.` };
      }
    } else if (q.criteria !== undefined) {
      // noul: criteria is optional, but if present must be a plain object.
      if (typeof q.criteria !== 'object' || q.criteria === null || Array.isArray(q.criteria)) {
        return { ok: false, message: `question "${id}" (noul) criteria, if present, must be an object with optional true/false descriptions.` };
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

  try {
    const client = getClient();
    const result = await client.systemOne({
      state: args.state as never,
      questions: validated.value,
      model: typeof args.model === 'string' ? args.model : undefined,
      provider,
    });
    return shapeRaw(result);
  } catch (err) {
    return typesafeToolError('typesafe_decide', err, {
      hint: 'Call typesafe_status to check which provider and model resolved for this call.',
    });
  }
}
