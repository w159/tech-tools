// The operating contract's header first-line pattern, as a code module. The host loader refuses a .json import from a hooks module
// (live: `is not named like code and was not loaded`), so restyle.tsx reads this constant; mod/contract-pattern.test.ts keeps it equal to
// contracts/operating-contract.json `headerFirstLinePattern`.
export const HEADER_FIRST_LINE_PATTERN = "^ATLAS \\| (?=(?:\\S+ )?(research|theory|test|validate|implement|verify|done|blocked)\\b)(?:\\S+ (?:research|theory|test|validate|implement|verify|done|blocked)( \\d+/\\d+)?|(?:research|theory|test|validate|implement|verify|done|blocked)( \\d+/\\d+)? \\S+( \\d+/\\d+)?) \\| \\S"
