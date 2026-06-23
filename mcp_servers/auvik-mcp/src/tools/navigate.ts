import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials } from '../credentials.js';
import { createAuvikClient } from '../client-factory.js';
import { missingCredsError, toolErrorFromCatch, shapeRaw } from './shared.js';

export const navigateTool: Tool = {
  name: 'auvik_navigate',
  description: 'Paginate through Auvik list results by following a links.next/links.prev absolute URL from a prior list call; use this instead of re-calling the list tool with re-encoded bracket params.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute URL from a prior response (links.next / links.first / links.prev). Must be on auvikapi.<region>.my.auvik.com/v1/.' },
    },
    required: ['url'],
    additionalProperties: false,
  },
};

export async function handleNavigate(args: { url: string }) {
  const c = getCredentials();
  if (!c) return missingCredsError('Auvik', ['AUVIK_USERNAME', 'AUVIK_API_KEY']);
  try {
    const resp = await createAuvikClient(c).followUrl(args.url);
    return shapeRaw(resp);
  } catch (e) {
    return toolErrorFromCatch('auvik_navigate', e, {
      hint: 'Ensure the url comes from a prior Auvik list response links.next/links.prev field.',
    });
  }
}
