import { defineDomain, getEntry } from './_helpers.js';

export const systemHandler = defineDomain([
  getEntry('sonicwall_version', 'SonicOS firmware version and model (GET /version).', '/version'),
  getEntry('sonicwall_system_status', 'System status: uptime, CPU, memory, connections (GET /reporting/status/system).', '/reporting/status/system'),
  getEntry('sonicwall_security_services_status', 'Security services status: signature versions and license state per service (GET /reporting/status/security-services).', '/reporting/status/security-services'),
  getEntry('sonicwall_interfaces_status', 'Interface link status summary (GET /reporting/status/interfaces).', '/reporting/status/interfaces'),
  getEntry('sonicwall_license_status', 'Licensing and subscription status (GET /reporting/license).', '/reporting/license'),
  getEntry('sonicwall_api_settings', 'SonicOS API settings: Basic auth, session security, bearer check (GET /administration/global/sonicos-api).', '/administration/global/sonicos-api'),
  getEntry('sonicwall_logged_in_users', 'Users currently logged in, including other admins holding the API session (GET /user/status/logged-in/all).', '/user/status/logged-in/all'),
]);
