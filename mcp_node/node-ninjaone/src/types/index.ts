/**
 * Type exports for NinjaOne API
 */

// Common types
export type {
  BaseListParams,
  BaseEntity,
  PaginatedResponse,
  CustomField,
  Location,
  TimestampFields,
} from './common.js';

// Organization types
export type {
  Organization,
  OrganizationListParams,
  OrganizationListResponse,
  OrganizationCreateData,
  OrganizationUpdateData,
  OrganizationDetailed,
} from './organizations.js';

// Device types
export type {
  Device,
  DeviceListParams,
  DeviceListResponse,
  DeviceUpdateData,
  DeviceStatus,
  DeviceNodeClass,
  DeviceSystem,
  DeviceOS,
  DeviceNetworkInterface,
  DeviceLastUser,
  DeviceActivity,
  DeviceActivityListResponse,
  DeviceActivityType,
  DeviceService,
  DeviceSoftware,
  DeviceProcessor,
  DeviceMemory,
  DeviceDisk,
  DeviceInventory,
  OsPatchInstall,
  OsPatchInstallListParams,
} from './devices.js';

// Alert types
export type {
  Alert,
  AlertListParams,
  AlertListResponse,
  AlertActionResult,
  AlertSeverity,
  AlertSourceType,
  AlertStatus,
} from './alerts.js';

// Ticket types
export type {
  Ticket,
  TicketListParams,
  TicketListResponse,
  TicketCreateData,
  TicketUpdateData,
  TicketStatus,
  TicketPriority,
  TicketType,
  TicketComment,
  TicketCommentCreateData,
  TicketAttachment,
  TicketForm,
  TicketFormField,
} from './tickets.js';

// Webhook types
export type {
  Webhook,
  WebhookListResponse,
  WebhookCreateData,
  WebhookUpdateData,
  WebhookActivityType,
  WebhookPayload,
} from './webhooks.js';
