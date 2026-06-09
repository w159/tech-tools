import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClientList,
  withClientItem,
  extractShapeArgs,
  SHAPE_PROPS,
  tenantsProp,
  pageProps,
  ENTITY_TYPES,
  ENTITY_AUDIT_CATEGORIES,
  ENTITY_AUDIT_STATUSES,
  type SummaryFn,
  type FlatResource,
} from './shared.js';

const noteSummary: SummaryFn<FlatResource> = (n: FlatResource) => ({
  id: n.id,
  entityName: n.entityName,
  entityType: n.entityType,
  note: n.note,
  lastModifiedBy: n.lastModifiedBy,
  modifiedAt: n.modifiedAt,
});

const auditSummary: SummaryFn<FlatResource> = (a: FlatResource) => ({
  id: a.id,
  user: a.user,
  category: a.category,
  status: a.status,
  createdAt: a.createdAt,
  closedAt: a.closedAt,
  entityId: (a.relationships as Record<string, unknown> | undefined) &&
    ((a.relationships as Record<string, unknown>)['entity'] as Record<string, unknown> | undefined) &&
    (((a.relationships as Record<string, unknown>)['entity'] as Record<string, unknown>)['data'] as Record<string, unknown> | undefined)?.id,
});

export const entitiesListNotesTool: Tool = {
  name: 'auvik_entities_list_notes',
  description: 'GET /v1/inventory/entity/note — list notes attached to entities (devices, networks, interfaces, root). Returns compact summary (id, entityName, entityType, note, lastModifiedBy, modifiedAt) by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
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
  description: 'GET /v1/inventory/entity/note/{id} — single entity note. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      noteId: { type: 'string', description: 'Auvik entity note ID.' },
      ...SHAPE_PROPS,
    },
    required: ['noteId'],
    additionalProperties: false,
  },
};

export const entitiesListAuditsTool: Tool = {
  name: 'auvik_entities_list_audits',
  description: 'GET /v1/inventory/entity/audit — list audit-log entries (terminal sessions, tunnels, remote-browser sessions). Returns compact summary (id, user, category, status, createdAt, closedAt, entityId) by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
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
  description: 'GET /v1/inventory/entity/audit/{id} — single audit-log entry. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      auditId: { type: 'string', description: 'Auvik entity audit ID.' },
      ...SHAPE_PROPS,
    },
    required: ['auditId'],
    additionalProperties: false,
  },
};

export const handleEntitiesListNotes = (args: Record<string, unknown>) =>
  withClientList((c) => c.entities.listNotes(args), noteSummary, extractShapeArgs(args), 'auvik_entities_list_notes');

export const handleEntitiesGetNote = (args: { noteId: string } & Record<string, unknown>) =>
  withClientItem((c) => c.entities.getNote(args.noteId), noteSummary, extractShapeArgs(args), 'auvik_entities_get_note');

export const handleEntitiesListAudits = (args: Record<string, unknown>) =>
  withClientList((c) => c.entities.listAudits(args), auditSummary, extractShapeArgs(args), 'auvik_entities_list_audits');

export const handleEntitiesGetAudit = (args: { auditId: string } & Record<string, unknown>) =>
  withClientItem((c) => c.entities.getAudit(args.auditId), auditSummary, extractShapeArgs(args), 'auvik_entities_get_audit');
