import { describe, it, expect, vi } from 'vitest';
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
    // auvik_list_widgets matches READ_PATTERNS; the marker must still win.
    const [t] = annotate([tool('auvik_list_widgets', 'DESTRUCTIVE: deletes every widget.')]);
    expect(t.annotations?.readOnlyHint).toBe(false);
    expect(t.annotations?.destructiveHint).toBe(true);
  });

  it('follows a VISIBLE-TO-OTHERS: marker the same way', () => {
    const [t] = annotate([tool('auvik_get_thing', 'VISIBLE-TO-OTHERS: posts a note other users see.')]);
    expect(t.annotations?.readOnlyHint).toBe(false);
  });

  it('does not annotate an unrecognised tool name read-only', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [t] = annotate([tool('auvik_frobnicate_widget', 'Does something the tables never saw.')]);
    expect(classifyTool('auvik_frobnicate_widget')).toBeUndefined();
    expect(t.annotations?.readOnlyHint).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('auvik_frobnicate_widget'));
    warn.mockRestore();
  });

  it('overrides a hand-written read-only annotation that contradicts the marker', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [t] = annotate([
      tool('auvik_whatever', 'DESTRUCTIVE: reboots the collector.', { readOnlyHint: true }),
    ]);
    expect(t.annotations?.readOnlyHint).toBe(false);
    warn.mockRestore();
  });

  it('still classifies the genuine reads as read-only', () => {
    // The six auvik_statistics_* tools match no pattern table and are declared
    // in CLASS_OVERRIDES; without that they would fail closed to mutating.
    for (const name of [
      'auvik_statistics_device',
      'auvik_statistics_device_availability',
      'auvik_statistics_interface',
      'auvik_statistics_service',
      'auvik_statistics_component',
      'auvik_statistics_oid',
    ]) {
      expect(classifyTool(name)).toBe('read');
    }
  });
});
