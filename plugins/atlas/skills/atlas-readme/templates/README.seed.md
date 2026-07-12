# <Project Name>

> Seed file. Replace every `<placeholder>` with the real values traced to a
> real file in the repo. Delete any section the repo does not warrant. Delete
> this blockquote before delivery. Every factual claim must trace to a
> specific file or line; unconfirmed commands stay marked [verify].

## What and Why

<One paragraph: what this project is and why it exists. Source the "what"
from the repo's package.json description, README, or top-level docs.>

## Quickstart

<The shortest path from clone to running, using the repo's actual commands.
Source each command from package.json scripts, a Makefile, or a CI file.>

```bash
<git clone ...>
<cd <repo>>
<install command, e.g. yarn install | npm install | uv sync>
<run command, e.g. yarn dev | npm run dev | make run>
```

## Prerequisites and Setup

<Exact commands using the repo's real package manager. List language runtime
versions from the repo's .nvmrc / .python-version / engines field.>

- <runtime> <version> (from <file>)
- <package manager> <version> (from <file>)

```bash
<install dependencies command>
```

## Project Structure

<Top-level directory map, one line each. Source from the actual repo tree.>

```
<dir-1>/    <one-line purpose>
<dir-2>/    <one-line purpose>
<file-1>    <one-line purpose>
```

## Architecture and Data Flow

<Prose description of the system. Include a Mermaid diagram only if the
system complexity warrants it; skip it for simple projects. Source each
component from a real file.>

## Configuration

<Env vars and config keys sourced from the real .env.example or config file.
Do not list env vars from memory.>

| Key | Required | Default | Description | Source |
|---|---|---|---|---|
| `<KEY>` | yes/no | <default> | <what it does> | <file> |

## Operations

### Run

```bash
<run command, sourced from a real script>
```

### Test

```bash
<test command, sourced from a real script>
```

### Build

```bash
<build command, sourced from a real script>
```

### Troubleshooting

<Common failure modes and fixes, sourced from real error states.>

- **<symptom>**: <cause and fix>.

## External Dependencies

<Links to the third-party or vendor docs the code actually relies on. Source
from the real dependency manifests.>

- [<dependency>](<url>) - <what it is used for, from which file>

## [verify] items

<Any claim or command left marked [verify] and why, or "none".>