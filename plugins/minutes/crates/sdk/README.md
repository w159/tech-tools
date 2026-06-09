# minutes-sdk

Conversation memory for AI agents. Query meeting transcripts, decisions, action items, and people from any AI agent or application.

The "Mem0 for human conversations." Works with [Minutes](https://github.com/silverstein/minutes) meeting files or any markdown with YAML frontmatter.

## Install

```bash
npm install minutes-sdk
```

## Quick start

```typescript
import { listMeetings, searchMeetings, findOpenActions } from 'minutes-sdk';

// List recent meetings
const meetings = await listMeetings('~/meetings');
// → [{ frontmatter: { title, date, action_items, decisions, ... }, body, path }]

// Search across all meetings
const results = await searchMeetings('~/meetings', 'pricing strategy');

// Find open action items
const actions = await findOpenActions('~/meetings', 'alex');
// → [{ path: '...', item: { assignee: 'alex', task: '...', status: 'open' } }]
```

## API

### `listMeetings(dir, limit?)`

List meetings sorted by date (newest first).

```typescript
const meetings = await listMeetings('~/meetings', 50);
```

### `searchMeetings(dir, query, limit?)`

Full-text search across titles and transcripts.

```typescript
const results = await searchMeetings('~/meetings', 'Q2 roadmap');
```

### `getMeeting(path)`

Read a single meeting file.

```typescript
const meeting = await getMeeting('~/meetings/2026-03-24-planning.md');
console.log(meeting.frontmatter.decisions);
```

### `findOpenActions(dir, assignee?)`

Find open action items, optionally filtered by assignee.

```typescript
const allOpen = await findOpenActions('~/meetings');
const mine = await findOpenActions('~/meetings', 'mat');
```

### `getPersonProfile(dir, name)`

Build a profile for someone across all meetings — their meetings, open action items, and topics.

```typescript
const profile = await getPersonProfile('~/meetings', 'alex');
// → { name, meetings: [...], openActions: [...], topics: ['pricing', 'api'] }
```

### `parseFrontmatter(content, path)`

Parse a markdown string into a `MeetingFile`. Useful for custom integrations.

```typescript
import { parseFrontmatter } from 'minutes-sdk';

const meeting = parseFrontmatter(markdownString, '/path/to/file.md');
```

## Use with AI frameworks

### Vercel AI SDK tool

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { searchMeetings } from 'minutes-sdk';

const meetingSearch = tool({
  description: 'Search past meeting transcripts and decisions',
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    const results = await searchMeetings('~/meetings', query, 5);
    return results.map(m => ({
      title: m.frontmatter.title,
      date: m.frontmatter.date,
      decisions: m.frontmatter.decisions,
      actions: m.frontmatter.action_items,
    }));
  },
});
```

### LangChain tool

```typescript
import { DynamicTool } from '@langchain/core/tools';
import { searchMeetings } from 'minutes-sdk';

const meetingTool = new DynamicTool({
  name: 'search_meetings',
  description: 'Search meeting transcripts for decisions and context',
  func: async (query) => {
    const results = await searchMeetings('~/meetings', query, 5);
    return JSON.stringify(results.map(m => ({
      title: m.frontmatter.title,
      date: m.frontmatter.date,
      summary: m.body.slice(0, 500),
    })));
  },
});
```

## Types

```typescript
interface MeetingFile {
  frontmatter: Frontmatter;
  body: string;      // Full markdown body (transcript, summary, notes)
  path: string;      // Absolute file path
}

interface Frontmatter {
  title: string;
  type: string;      // "meeting" | "memo" | "dictation"
  date: string;      // ISO 8601
  duration: string;
  source?: string;   // "voice-memos" | "dictation" | undefined
  device?: string;   // "iPhone" etc (cross-device pipeline)
  tags: string[];
  attendees: string[];
  people: string[];
  action_items: ActionItem[];
  decisions: Decision[];
  intents: Intent[];  // Structured commitments, questions, decisions
}

interface ActionItem {
  assignee: string;
  task: string;
  due?: string;
  status: string;    // "open" | "done"
}

interface Decision {
  text: string;
  topic?: string;
}

interface Intent {
  kind: string;      // "commitment" | "decision" | "open-question"
  what: string;
  who?: string;
  status: string;
  by_date?: string;
}
```

## How it works

The SDK reads markdown files with YAML frontmatter produced by [Minutes](https://github.com/silverstein/minutes). No database, no server, no API key — just files on disk.

```
~/meetings/
├── 2026-03-24-q2-planning.md          ← meetings
├── 2026-03-24-client-call.md
└── memos/
    ├── 2026-03-24-pricing-idea.md     ← voice memos
    └── 2026-03-23-onboarding-thought.md
```

Each file has structured YAML frontmatter (title, date, attendees, action items, decisions, intents) and a markdown body (transcript, summary, notes). The SDK parses these and provides query functions.

## License

MIT
