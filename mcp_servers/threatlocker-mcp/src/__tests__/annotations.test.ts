import { describe, it, expect, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { annotate, classifyTool } from '../annotate-tool.js';

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
    // threatlocker_computers_list matches READ_PATTERNS; the marker must still win.
    const [t] = annotate([tool('threatlocker_computers_list', 'DESTRUCTIVE: tears the thing down.')]);
    expect(t.annotations?.readOnlyHint).toBe(false);
    expect(t.annotations?.destructiveHint).toBe(true);
  });

  it('follows a VISIBLE-TO-OTHERS: marker the same way', () => {
    const [t] = annotate([tool('threatlocker_computers_get', 'VISIBLE-TO-OTHERS: posts something other users see.')]);
    expect(t.annotations?.readOnlyHint).toBe(false);
  });

  it('does not annotate an unrecognised tool name read-only', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [t] = annotate([tool('threatlocker_frobnicate_computer', 'Does something the tables never saw.')]);
    expect(classifyTool('threatlocker_frobnicate_computer')).toBeUndefined();
    expect(t.annotations?.readOnlyHint).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('threatlocker_frobnicate_computer'));
    warn.mockRestore();
  });

  it('overrides a hand-written read-only annotation that contradicts the marker', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [t] = annotate([
      tool('threatlocker_computers_get', 'DESTRUCTIVE: reboots the appliance.', { readOnlyHint: true }),
    ]);
    expect(t.annotations?.readOnlyHint).toBe(false);
    warn.mockRestore();
  });

  it('still classifies the genuine reads as read-only', () => {
    // Matches no pattern table and is declared in CLASS_OVERRIDES; without that
  // it would fail closed to mutating. It only lists maintenance modes.
    for (const name of [
      'threatlocker_computers_maintenance_modes',
    ]) {
      expect(classifyTool(name)).toBe('read');
    }
  });
});
