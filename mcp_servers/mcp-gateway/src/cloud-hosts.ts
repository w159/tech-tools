// Microsoft cloud endpoints the gateway and the admin CLI may send a Graph
// bearer token or the client secret to. A mistyped or malicious override must
// not redirect credentials to another host.
// Learn: graph/deployments (Graph service roots and Entra token endpoints for
// global, US Government L4/L5 and China operated by 21Vianet).
export const GRAPH_HOSTS: readonly string[] = [
  "graph.microsoft.com",
  "graph.microsoft.us",
  "dod-graph.microsoft.us",
  "microsoftgraph.chinacloudapi.cn",
];
export const AUTHORITY_HOSTS: readonly string[] = ["login.microsoftonline.com", "login.microsoftonline.us", "login.chinacloudapi.cn"];

// True for https on the default port at one of the allowed host names.
export function isAllowedCloudHost(url: URL, allowed: readonly string[]): boolean {
  return url.protocol === "https:" && url.port === "" && allowed.includes(url.hostname.toLowerCase());
}
