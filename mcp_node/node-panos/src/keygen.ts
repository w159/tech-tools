import * as https from 'node:https';
import { assertSuccess } from './xml.js';

/**
 * type=keygen is a POST with credentials in the body, never a GET with them
 * in the URL (design doc: Authentication). The postman collection shows the
 * GET form; it is not copied here.
 */
export async function keygen(args: { host: string; user: string; password: string; verifyTls?: boolean }): Promise<string> {
  const url = `https://${args.host}/api/?type=keygen`;
  const body = new URLSearchParams({ user: args.user, password: args.password }).toString();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

  const text = await (args.verifyTls === false ? insecurePost(url, body, headers) : securePost(url, body, headers));
  const response = assertSuccess(text.text, text.status) as Record<string, any>;
  return response.result.key as string;
}

async function securePost(url: string, body: string, headers: Record<string, string>): Promise<{ text: string; status: number }> {
  const res = await fetch(url, { method: 'POST', headers, body });
  return { text: await res.text(), status: res.status };
}

function insecurePost(url: string, body: string, headers: Record<string, string>): Promise<{ text: string; status: number }> {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const req = https.request(url, { method: 'POST', headers, agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
