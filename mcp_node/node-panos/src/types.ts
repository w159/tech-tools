export interface PanosConfig {
  host: string;
  apiKey: string;
  /** Default managed-firewall serial when talking through Panorama. */
  target?: string;
  /** Set false only for an appliance with a self-signed certificate. Default true. */
  verifyTls?: boolean;
  /** REST API version segment, e.g. 'v11.1'. */
  restVersion?: string;
  timeoutMs?: number;
}

export type ConfigAction =
  | 'show'
  | 'get'
  | 'set'
  | 'edit'
  | 'delete'
  | 'rename'
  | 'clone'
  | 'move'
  | 'override'
  | 'multi-move'
  | 'multi-clone'
  | 'complete';

export interface ConfigParams {
  xpath?: string;
  element?: string;
  newname?: string;
  from?: string;
  where?: string;
  dst?: string;
  target?: string;
}

/**
 * Log retrieval is two-phase: a query returns a job id, then `action: 'get'`
 * with that `job-id` fetches the rows. Neither phase sends the other's fields,
 * so everything past `target` is optional.
 */
export interface LogParams {
  'log-type'?: string;
  query?: string;
  nlogs?: string;
  skip?: string;
  dir?: string;
  action?: string;
  'job-id'?: string;
  target?: string;
}

/** Reports are two-phase in the same way as logs. */
export interface ReportParams {
  reporttype?: string;
  reportname?: string;
  period?: string;
  starttime?: string;
  endtime?: string;
  topn?: string;
  category?: string;
  cmd?: string;
  action?: string;
  'job-id'?: string;
  target?: string;
}

export interface ExportParams {
  category: string;
  from?: string;
  'certificate-name'?: string;
  format?: string;
  'include-key'?: string;
  passphrase?: string;
  vsys?: string;
  /** Tech-support export polls with action + job-id. */
  action?: string;
  'job-id'?: string;
  /** Threat packet capture selectors. */
  'pcap-id'?: string;
  'search-time'?: string;
  sessionid?: string;
  target?: string;
}

export interface ImportParams {
  category: string;
  'target-tpl'?: string;
  'target-tpl-vsys'?: string;
  vsys?: string;
  /**
   * Hyphenated to match PAN-OS's wire spelling: these keys are spread straight
   * into the query string, so an underscore here would send a parameter the
   * appliance ignores and the import would silently land unnamed.
   */
  'certificate-name'?: string;
  format?: string;
  passphrase?: string;
  target?: string;
}

export type RestLocationKind = 'vsys' | 'device-group' | 'shared' | 'panorama-pushed' | 'template' | 'predefined';

export interface RestLocation {
  location: RestLocationKind;
  vsys?: string;
  'device-group'?: string;
  template?: string;
  target?: string;
}

export interface JobStatus {
  id: string;
  status: string;
  progress?: string;
  result?: unknown;
}
