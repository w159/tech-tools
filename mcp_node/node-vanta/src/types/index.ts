export * from './common.js';

// Vanta domain object types. Fields kept loose (Record<string, unknown> is
// fine downstream) because Vanta's schema surface is large and the MCP
// server just forwards JSON. We type a few high-value fields explicitly.

export interface Framework {
  id: string;
  name?: string;
  productFamily?: string;
  description?: string;
  [k: string]: unknown;
}

export interface Control {
  id: string;
  name?: string;
  description?: string;
  frameworks?: string[];
  [k: string]: unknown;
}

export interface Test {
  id: string;
  name?: string;
  status?: string;
  frameworks?: string[];
  [k: string]: unknown;
}

export interface Document {
  id: string;
  name?: string;
  status?: string;
  frameworks?: string[];
  [k: string]: unknown;
}

export interface Integration {
  integrationId: string;
  displayName?: string;
  resourceKinds?: string[];
  [k: string]: unknown;
}

export interface IntegrationResourceKind {
  integrationId?: string;
  resourceKind: string;
  isScopable?: boolean;
  numResources?: number;
  numInScope?: number;
  [k: string]: unknown;
}

export interface IntegrationResource {
  id: string;
  [k: string]: unknown;
}

export interface Person {
  id: string;
  displayName?: string;
  email?: string;
  [k: string]: unknown;
}

export interface Vendor {
  id: string;
  name?: string;
  status?: string;
  [k: string]: unknown;
}

export interface RiskScenario {
  id: string;
  name?: string;
  [k: string]: unknown;
}

export interface Vulnerability {
  id: string;
  title?: string;
  severity?: string;
  isFixAvailable?: boolean;
  slaDeadline?: string;
  [k: string]: unknown;
}

export interface Policy {
  id: string;
  name?: string;
  status?: string;
  [k: string]: unknown;
}

export interface MonitoredComputer {
  id: string;
  hostIdentifier?: string;
  complianceStatus?: string;
  [k: string]: unknown;
}

// List filter param interfaces (all extend ListParams)
import type { ListParams } from './common.js';

export interface ControlListParams extends ListParams {
  frameworkMatchesAny?: string[];
}
export interface TestListParams extends ListParams {
  statusFilter?: string;
  frameworkFilter?: string;
}
export interface DocumentListParams extends ListParams {
  frameworkMatchesAny?: string[];
  statusMatchesAny?: string[];
}
export interface PersonListParams extends ListParams {
  emailAndNameFilter?: string;
  groupIdsMatchesAny?: string[];
}
export interface VulnerabilityListParams extends ListParams {
  q?: string;
  isFixAvailable?: boolean;
}
export interface MonitoredComputerListParams extends ListParams {
  complianceStatusFilterMatchesAny?: string[];
}
