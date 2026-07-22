---
title: Text Manipulation
category: Practice
chapter: 3
topic: 21
source: "Chapter 3, Topic 21 \"Text Manipulation\""
tips: [35]
aliases: [Learn a Text Manipulation Language]
related: [plain-text, shell-games]
---

# Text Manipulation

**In brief:** Learn a general-purpose text manipulation language so you can quickly build utilities and prototype ideas that would take far longer in a conventional language.

**Category:** Practice
**Source:** Chapter 3, Topic 21 "Text Manipulation"
**Also known as:** Learn a Text Manipulation Language

## What it is
Pragmatic Programmers shape text the way woodworkers shape wood. Shells, editors, and debuggers are like a woodworker's chisels, saws, and planes: specialized to do one or two jobs well. But every so often you need a transformation the basic tool set does not readily handle, so you need a general-purpose text manipulation tool.

The book compares text manipulation languages to routers in woodworking: noisy, messy, somewhat brute force, and capable of ruining a piece if you slip. Some people say they have no place in the toolbox. But in the right hands they are powerful and versatile, with surprising finesse, and they take time to master. There are several great ones: Unix and macOS users often lean on the command shell augmented with awk and sed, while people who prefer a more structured tool reach for Python or Ruby.

## Why it matters
These languages are enabling technologies. With them you can hack up utilities and prototype ideas in five or ten times less code than a conventional language, and that multiplying factor is crucial to experimentation. Spending 30 minutes on a crazy idea beats spending five hours; spending a day automating a project component is acceptable, while spending a week may not be. In The Practice of Programming, Kernighan and Pike built the same program in five languages, and the Perl version was shortest at 17 lines versus C's 150. With a language like Perl you can manipulate text, interact with programs, talk over networks, drive web pages, and do arbitrary-precision arithmetic.

## In practice
The book lists real jobs done with Ruby and Python just to build the book itself:

- The Pragmatic Bookshelf build system is written in Ruby, with Rake tasks coordinating PDF and ebook builds.
- Code inclusion and highlighting: rather than copy-paste code (violating DRY), a Ruby script extracts a named segment from a tested source file, syntax-highlights it, and converts it to the typesetting language.
- Website update: a script does a partial build, extracts the table of contents, and uploads it; another extracts sample sections.
- A Python script converts LaTeX math markup into formatted text.
- Index generation: entries are marked up in the text and a Ruby script collates and formats them.

The exercises reinforce the habit: write a script that converts every .yaml file in a directory to .json; scan source files for camelCase names and report them; then extend it to rename those names automatically while keeping a backup of the originals. If you keep your knowledge in plain text, these languages bring a whole host of benefits.

## Related tips
- Tip 35: "Learn a Text Manipulation Language"

## See also
- [plain-text](plain-text.md)
- [shell-games](shell-games.md)
