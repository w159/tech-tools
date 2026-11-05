# Prompts for chat models

Use when the user wants a prompt to paste into ChatGPT, Claude.ai or another assistant, rather
than a task spec for a coding agent in this repository.

## Rules

- One fenced block holding the finished prompt. No preface, no trailing notes.
- No placeholders such as `[paste X here]` or `{topic}`. Either bake in the content the user gave
  (their draft, numbers, code), or end the prompt by telling the model to ask for what it needs.
- Same language as the user's input.

## What a good chat prompt carries

Write only the parts the task needs, in this order:

1. Role, in one line, when it sharpens tone or expertise.
2. Context the model cannot know: audience, purpose, what the output is for, and why a rule exists
   ("read aloud by a TTS engine, so no ellipses" is followed better than a bare ban).
3. The task, as a direct instruction that names the output.
4. Success criteria and format: length, structure, what to include, and what to do instead of the
   thing to avoid ("write flowing paragraphs" beats "no bullet points").
5. Examples, 1 to 3 in `<example>` tags, only when format or tone is hard to describe.
6. For long pasted material: material first, question last.

Match the prompt's own formatting to the output wanted: a prompt full of markdown gets markdown back.
Use XML tags only when sections multiply. Leave out "think step by step" and closing reasoning lines:
current models set their own reasoning depth from the effort setting, and the extra line adds length
without changing the result.

For code review prompts, ask for every finding with a confidence and severity, so a later pass can
rank them; "only flag important issues" makes models over-filter.

## Examples

User: "I want a prompt to summarize my emails"

```
You are helping me triage email. I'll paste a batch of emails in my next message.

For each email give the sender and subject on one line, a one or two sentence neutral summary, the
action it needs (reply, schedule, delegate, FYI, ignore) and a priority (high, medium, low) based on
the sender and any deadline. Group by priority. List automated marketing under a final "Filtered out"
heading with sender and subject only, so I can check it.

Ask me to paste the emails when you're ready.
```

User: "write me a haiku about coffee"

```
Write a haiku about coffee in the 5-7-5 syllable form. Build it on one concrete image a reader can
picture, and avoid stock phrases like "morning steam".
```

Simple tasks get one short paragraph: no role, no tags, no sections.
