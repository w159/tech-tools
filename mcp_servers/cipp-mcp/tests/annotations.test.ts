import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { annotate, classifyTool } from '../src/annotate-tool.js';

// classifyTool() used to `return "read"` for any name its pattern tables did
// not match. readOnlyHint is the flag an MCP client reads to decide it may run
// a tool without asking, so an unanticipated mutating tool shipped as "safe to
// auto-run" while its own description said DESTRUCTIVE. These specs pin the two
// halves of the fix: the description marker wins, and an unrecognised name
// fails closed.
const tool = (name: string, description: string, annotations?: Tool['annotations']): Tool => ({
  name,
  description,
  inputSchema: { type: 'object' as const, properties: {} },
  ...(annotations ? { annotations } : {}),
});

describe('annotate', () => {
  it('follows a DESTRUCTIVE: description marker even for a read-looking name', () => {
    // cipp_list_tenants matches READ_PATTERNS; the marker must still win.
    const [t] = annotate([tool('cipp_list_tenants', 'DESTRUCTIVE: tears the thing down.')]);
    expect(t.annotations?.readOnlyHint).toBe(false);
    expect(t.annotations?.destructiveHint).toBe(true);
  });

  it('follows a VISIBLE-TO-OTHERS: marker the same way', () => {
    const [t] = annotate([tool('cipp_get_tenant_details', 'VISIBLE-TO-OTHERS: posts something other users see.')]);
    expect(t.annotations?.readOnlyHint).toBe(false);
  });

  it('does not annotate an unrecognised tool name read-only', () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    const [t] = annotate([tool('cipp_frobnicate_tenant', 'Does something the tables never saw.')]);
    expect(classifyTool('cipp_frobnicate_tenant')).toBeUndefined();
    expect(t.annotations?.readOnlyHint).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cipp_frobnicate_tenant'));
    warn.mockRestore();
  });

  it('overrides a hand-written read-only annotation that contradicts the marker', () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    const [t] = annotate([
      tool('cipp_get_tenant_details', 'DESTRUCTIVE: reboots the appliance.', { readOnlyHint: true }),
    ]);
    expect(t.annotations?.readOnlyHint).toBe(false);
    warn.mockRestore();
  });

  it('still classifies the genuine reads as read-only', () => {
    // Every cipp tool name matches a pattern table today, so CLASS_OVERRIDES is
  // empty; these pin that the read patterns still answer for the real surface.
    for (const name of [
      'cipp_list_tenants',
      'cipp_get_tenant_details',
      'cipp_list_users',
    ]) {
      expect(classifyTool(name)).toBe('read');
    }
  });
});
