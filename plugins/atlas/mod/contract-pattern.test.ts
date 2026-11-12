// The generated-by-hand constant stays equal to the contract file (the host cannot import the JSON itself).
import { expect, test } from 'claude-code/testing';
import contract from '../contracts/operating-contract.json';
import { HEADER_FIRST_LINE_PATTERN } from './contract-pattern';

test('HEADER_FIRST_LINE_PATTERN equals contracts/operating-contract.json headerFirstLinePattern', () => {
  expect(HEADER_FIRST_LINE_PATTERN).toBe((contract as { headerFirstLinePattern: string }).headerFirstLinePattern);
  expect(HEADER_FIRST_LINE_PATTERN).not.toBe('');
});
