---
title: The Power of Plain Text
category: Principle
chapter: 3
topic: 16
source: "Chapter 3, Topic 16 \"The Power of Plain Text\""
tips: [25]
aliases: [Keep Knowledge in Plain Text]
related: [shell-games, text-manipulation, version-control, configuration]
---

# The Power of Plain Text

**In brief:** Store knowledge persistently in human-readable, self-describing plain text rather than opaque binary formats.

**Category:** Principle
**Source:** Chapter 3, Topic 16 "The Power of Plain Text"
**Also known as:** Keep Knowledge in Plain Text

## What it is
A Pragmatic Programmer's base material is knowledge: requirements, designs, implementations, tests, and documents. The book argues the best format for storing that knowledge persistently is plain text, meaning printable characters arranged in a form that conveys information to a human, not random characters and not a cryptic "Field19=467abe".

Plain text does not mean unstructured. HTML, JSON, YAML, and the fundamental net protocols (HTTP, SMTP, IMAP) are all plain text. The key property is that the data carries its own meaning: a self-describing data stream independent of the application that created it. Binary formats break this because the context needed to understand the data lives separately in application logic, so the data is effectively meaningless (as good as encrypted) without that program.

The book illustrates this with a legacy data file. Knowing nothing about the original application beyond the fact that it tracked clients' Social Security numbers, you can spot <FIELD10>123-45-6789</FIELD10> by the shape of the SSN alone and write a small program to extract it, even with no other information about the file. Had the same value been encoded instead as "AC27123456789B11P," you would not have recognized it so readily: that is the difference between human readable and human understandable. The tag name FIELD10 itself does not help much either; renaming it to <SOCIAL-SECURITY-NO>123-45-6789</SOCIAL-SECURITY-NO> makes the exercise a no-brainer and ensures the data will outlive any project that created it.

## Why it matters
Plain text buys three things the book names directly: insurance against obsolescence, leverage of existing tools, and easier testing. Human-readable, self-describing data outlives the applications that created it, so your knowledge survives long after the original program is defunct. You can parse a plain-text file with only partial knowledge of its format; a binary file usually demands complete knowledge of the whole format.

Ignoring this couples your data to one application forever. When that application dies, or when a system crash leaves you with only a minimal recovery environment and no graphics drivers, opaque data becomes a liability. Plain text is the lowest common denominator that guarantees all parties can still communicate.

## In practice
Lean on the Unix philosophy of small, sharp tools that each do one thing well, unified by the line-oriented plain-text file. Virtually every tool in computing, from version control to editors to command-line utilities, operates on plain text.

Concrete uses the book gives: put a site-specific config file under version control so you keep a history of every change; use diff or fc to see changes at a glance; use sum to checksum a file and detect accidental or malicious modification; run "grep -r backup /etc" to find which config file manages backups; drive system tests with plain-text synthetic data you can edit by hand; analyze plain-text regression output with a shell command or a short script.

## Related tips
- Tip 25: "Keep Knowledge in Plain Text"

## See also
- [shell-games](shell-games.md)
- [text-manipulation](text-manipulation.md)
- [version-control](version-control.md)
- [configuration](configuration.md)
