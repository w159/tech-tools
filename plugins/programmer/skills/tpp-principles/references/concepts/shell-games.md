---
title: Shell Games
category: Practice
chapter: 3
topic: 17
source: "Chapter 3, Topic 17 \"Shell Games\""
tips: [26]
aliases: [Use the Power of Command Shells]
related: [plain-text, text-manipulation, power-editing, prototypes, transforming-programming, pragmatic-starter-kit]
---

# Shell Games

**In brief:** Use the command shell as your workbench, because it combines and automates tools in ways a GUI cannot.

**Category:** Practice
**Source:** Chapter 3, Topic 17 "Shell Games"
**Also known as:** Use the Power of Command Shells

## What it is
For a programmer manipulating files of text, the command shell is the workbench: the center of the workshop you return to time and again. From the shell prompt you can invoke your full repertoire of tools, use pipes to combine them in ways their original developers never imagined, launch applications, debuggers, browsers, editors, and utilities, search for files, query system status, and filter output. By programming the shell you build complex macro commands for activities you do often.

The book confronts the GUI-and-IDE objection head on. GUIs are wonderful and can be faster for simple operations like moving files or reading email. But their benefit, WYSIWYG (what you see is what you get), carries the disadvantage WYSIAYG (what you see is all you get). A GUI is limited to the capabilities its designers intended, and Pragmatic Programmers routinely need to go beyond that model.

An example: to list every unique package name explicitly imported by your Java code and store it in a file, one shell line does it: grep '^import ' *.java | sed -e's/.*import *//' -e's/;.*$//' | sort -u >list. That kind of composition is the shell's whole point.

## Why it matters
If you do all your work through GUIs, you cannot automate common tasks, cannot use the full power of the tools available, and cannot combine tools into customized macro tools. When you need to integrate something the IDE designer never anticipated (a code preprocessor for design-by-contract, say), you are simply out of luck unless explicit hooks exist. Familiarity with the shell makes productivity soar.

## In practice
Invest energy in learning your shell and things fall into place. Then customize it the way a woodworker customizes a bench:

- Color themes and a configured prompt (a short current-directory name, version control status, and the time make good prompt content).
- Aliases and shell functions for commands you repeat: alias apt-up='sudo apt-get update && sudo apt-get upgrade', or alias rm='rm -iv' so deletes always prompt.
- Command completion beyond the basics: configure context-specific completions, some even varying by current directory.

You will spend a lot of time living in a shell, so be like a hermit crab and make it your home. When moving to a new environment, find out which shells are available and try to bring yours with you. If your shell cannot solve a problem, investigate an alternative that can.

## Related tips
- Tip 26: "Use the Power of Command Shells"

## See also
- [plain-text](plain-text.md)
- [text-manipulation](text-manipulation.md)
- [power-editing](power-editing.md)
- [prototypes](prototypes.md)
- [transforming-programming](transforming-programming.md)
- [pragmatic-starter-kit](pragmatic-starter-kit.md)
