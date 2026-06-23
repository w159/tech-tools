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
  description: 'List notes attached to Auvik entities (devices, networks, interfaces, or root); use to retrieve operator notes or find who last annotated a specific entity. (GET /v1/inventory/entity/note)',
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
  description: 'Fetch a single entity note by ID; use after auvik_entities_list_notes to read the full note content. (GET /v1/inventory/entity/note/{id})',
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
  description: 'List audit-log entries for entity access events (terminal sessions, SSH tunnels, remote-browser sessions); use to investigate who accessed a device and when. (GET /v1/inventory/entity/audit)',
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
  description: 'Fetch a single audit-log entry by ID; use after auvik_entities_list_audits to retrieve session detail for a specific access event. (GET /v1/inventory/entity/audit/{id})',
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
