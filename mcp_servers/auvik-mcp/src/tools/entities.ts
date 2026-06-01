import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClient,
  tenantsProp,
  pageProps,
  ENTITY_TYPES,
  ENTITY_AUDIT_CATEGORIES,
  ENTITY_AUDIT_STATUSES,
} from './shared.js';

export const entitiesListNotesTool: Tool = {
  name: 'auvik_entities_list_notes',
  description: 'GET /v1/inventory/entity/note — list notes attached to entities (devices, networks, interfaces, root).',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      filter_entityId: { type: 'string', description: 'filter[entityId] — the noted entity ID.' },
      filter_entityType: { type: 'string', enum: [...ENTITY_TYPES], description: 'filter[entityType].' },
      filter_entityName: { type: 'string', description: 'filter[entityName].' },
      filter_lastModifiedBy: { type: 'string', description: 'filter[lastModifiedBy] — user who last edited the note.' },
      filter_modifiedAfter: { type: 'string', description: 'filter[modifiedAfter] ISO 8601.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const entitiesGetNoteTool: Tool = {
  name: 'auvik_entities_get_note',
  description: 'GET /v1/inventory/entity/note/{id} — single entity note.',
  inputSchema: {
    type: 'object',
    properties: { noteId: { type: 'string', description: 'Auvik entity note ID.' } },
    required: ['noteId'],
    additionalProperties: false,
  },
};

export const entitiesListAuditsTool: Tool = {
  name: 'auvik_entities_list_audits',
  description: 'GET /v1/inventory/entity/audit — list audit-log entries (terminal sessions, tunnels, remote-browser sessions).',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      filter_user: { type: 'string', description: 'filter[user] — the acting user.' },
      filter_category: { type: 'string', enum: [...ENTITY_AUDIT_CATEGORIES], description: 'filter[category].' },
      filter_status: { type: 'string', enum: [...ENTITY_AUDIT_STATUSES], description: 'filter[status].' },
      filter_modifiedAfter: { type: 'string', description: 'filter[modifiedAfter] ISO 8601.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const entitiesGetAuditTool: Tool = {
  name: 'auvik_entities_get_audit',
  description: 'GET /v1/inventory/entity/audit/{id} — single audit-log entry.',
  inputSchema: {
    type: 'object',
    properties: { auditId: { type: 'string', description: 'Auvik entity audit ID.' } },
    required: ['auditId'],
    additionalProperties: false,
  },
};

export const handleEntitiesListNotes = (args: Record<string, unknown>) =>
  withClient((c) => c.entities.listNotes(args));
export const handleEntitiesGetNote = (args: { noteId: string }) =>
  withClient((c) => c.entities.getNote(args.noteId));
export const handleEntitiesListAudits = (args: Record<string, unknown>) =>
  withClient((c) => c.entities.listAudits(args));
export const handleEntitiesGetAudit = (args: { auditId: string }) =>
  withClient((c) => c.entities.getAudit(args.auditId));
