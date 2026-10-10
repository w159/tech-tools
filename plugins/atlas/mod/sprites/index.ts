/**
 * Sprite atlas: default-export SpriteSets from every persona sprite module.
 *
 * keys match the persona names used across agents/*.md frontmatter.
 * `spriteFor` maps a persona string to a SpriteSet (armada-* => armada,
 * missing => unknown). Ponytail: unknown fallback, upgrade when a persona
 * ships its own sprite.
 */

import type { SpriteSet } from '../contract';

import lead from './lead';
import runner from './runner';
import explorer from './explorer';
import planner from './planner';
import implementer from './implementer';
import verifier from './verifier';
import critic from './critic';
import rls from './rls';
import dbprober from './dbprober';
import uitester from './uitester';
import docscurator from './docscurator';
import docsauditor from './docsauditor';
import schema from './schema';
import naming from './naming';
import armada from './armada';
import unknownSprite from './unknown';

/** All known SpriteSets keyed by persona name. */
export const SPRITES: Record<string, SpriteSet> = {
  'lead': lead,
  'runner': runner,
  'explorer': explorer,
  'planner': planner,
  'implementer': implementer,
  'verifier': verifier,
  'completeness-critic': critic,
  'rls-privilege-audit': rls,
  'db-prober': dbprober,
  'ui-runtime-tester': uitester,
  'docs-curator': docscurator,
  'docs-auditor': docsauditor,
  'schema-inventory': schema,
  'naming-glossary-audit': naming,
  'armada': armada,
  'unknown': unknownSprite,
};

/** Persona string -> SpriteSet. armada-* => armada, missing => unknown. */
export function spriteFor(persona: string): SpriteSet {
  // noUncheckedIndexedAccess makes Record lookups `SpriteSet | undefined`, so the
  // fallbacks use the imported bindings (always defined), not indexed entries.
  if (persona.startsWith('armada-')) return armada;
  return SPRITES[persona] ?? unknownSprite;
}
