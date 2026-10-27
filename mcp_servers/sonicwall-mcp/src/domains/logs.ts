import { defineDomain, getEntry, queryEntry } from './_helpers.js';

export const logsHandler = defineDomain([
  queryEntry('sonicwall_log_view', 'View the event log (GET /reporting/log/view). Large logs are truncated; narrow with query parameters from sonicwall_navigate.', '/reporting/log/view'),
  queryEntry('sonicwall_audit_log_view', 'View the audit log of admin actions (GET /log/audit/view).', '/log/audit/view'),
  getEntry('sonicwall_audit_log_settings', 'Audit log settings (GET /log/audit/base).', '/log/audit/base'),
  getEntry('sonicwall_syslog_servers', 'Configured syslog servers (GET /log/syslog/syslog-servers).', '/log/syslog/syslog-servers'),
  queryEntry('sonicwall_export_log_csv', 'Export the event log as CSV text (GET /export/log/csv).', '/export/log/csv', 'text/plain'),
  queryEntry('sonicwall_export_audit_csv', 'Export the audit log as CSV text (GET /export/audit/csv).', '/export/audit/csv', 'text/plain'),
]);
