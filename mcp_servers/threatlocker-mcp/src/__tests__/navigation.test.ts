import { describe, it, expect } from 'vitest';
import { getNavigationTools, DOMAINS } from '../domains/navigation.js';

describe('Navigation', () => {

  it('should have all v0.1.0 domains', () => {
    expect(DOMAINS).toContain('computers');
    expect(DOMAINS).toContain('computer_groups');
    expect(DOMAINS).toContain('approval_requests');
    expect(DOMAINS).toContain('audit_log');
    expect(DOMAINS).toContain('organizations');
  });

  it('should return navigation tools', () => {
    const tools = getNavigationTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('threatlocker_navigate');
    expect(tools[1].name).toBe('threatlocker_status');
  });

  it('should have navigate tool as discovery aid', () => {
    const tools = getNavigationTools();
    const navigateTool = tools.find(t => t.name === 'threatlocker_navigate');
    expect(navigateTool?.description).toContain('discovery aid');
    expect(navigateTool?.description).toContain('All tools are callable at any time');
  });

  it('should have status tool for connection info', () => {
    const tools = getNavigationTools();
    const statusTool = tools.find(t => t.name === 'threatlocker_status');
    expect(statusTool?.description).toContain('configuration status');
  });
});
