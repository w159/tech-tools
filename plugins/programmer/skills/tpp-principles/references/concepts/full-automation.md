---
title: Full Automation
category: Practice
chapter: 9
topic: 51
source: "Chapter 9, Topic 51 \"Pragmatic Starter Kit\""
tips: [95]
aliases: ["don't use manual procedures"]
related: [pragmatic-starter-kit, continuous-testing, reversibility, tracer-bullets, shell-games, version-control, test-to-code, pragmatic-teams, coconuts-dont-cut-it]
---

# Full Automation

**In brief:** Run every recurring project procedure through scripted, repeatable automation with no manual intervention, because people are not as repeatable as computers and one manual step breaks a very large window.

**Category:** Practice
**Source:** Chapter 9, Topic 51 "Pragmatic Starter Kit"
**Also known as:** don't use manual procedures

## What it is
Modern development relies on scripted, automatic procedures. Whether you use something as simple as shell scripts with rsync and ssh or full-featured tools such as Ansible, Puppet, Chef, or Salt, the rule is the same: do not rely on any manual intervention. Full automation is one of the three legs of the Pragmatic Starter Kit, alongside version control and ruthless testing.

The book tells of a client where every developer installed IDE add-on packages by following many pages of click here, scroll there, drag this, double-click that. Not surprisingly, every machine ended up loaded slightly differently, subtle behavior differences appeared, and bugs showed on one machine but not others. People just are not as repeatable as computers are, nor should we expect them to be. A shell script or program executes the same instructions in the same order every time, and because the script is itself under version control, you can examine how build and release procedures changed over time when someone claims "but it used to work."

Everything depends on automation. You cannot build the project on an anonymous cloud server unless the build is fully automatic, and you cannot deploy automatically if there are manual steps involved. The moment you introduce a manual step, "just for this one part," you have broken a very large window, in the sense of Software Entropy from Topic 3.

## Why it matters
Automation buys consistency and repeatability, the two things manual procedures leave to chance. Manual steps produce machines that drift apart, behavior that varies by operator, and bugs that hide on one setup while passing on another. They also block the whole continuous delivery model, because ephemeral cloud build machines and tag-driven releases only work when no human has to intervene. A single manual exception is not a small compromise; it breaks a large window and invites entropy into the whole process.

## In practice
Script every recurring task: build, release, testing, environment setup, project paperwork. Reach for shell scripts and ssh/rsync when that is enough, or configuration management tools like Ansible, Puppet, Chef, or Salt when it is not. Keep the automation itself under version control so its history is auditable. Refuse manual steps even for one small part, because that is the window that breaks.

## Related tips
- Tip 95: "Don't Use Manual Procedures"

## See also
- [pragmatic-starter-kit](pragmatic-starter-kit.md)
- [continuous-testing](continuous-testing.md)
- [reversibility](reversibility.md)
- [tracer-bullets](tracer-bullets.md)
- [shell-games](shell-games.md)
- [version-control](version-control.md)
- [test-to-code](test-to-code.md)
- [pragmatic-teams](pragmatic-teams.md)
- [coconuts-dont-cut-it](coconuts-dont-cut-it.md)

