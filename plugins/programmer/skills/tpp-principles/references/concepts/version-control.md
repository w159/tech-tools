---
title: Version Control
category: Practice
chapter: 3
topic: 19
source: "Chapter 3, Topic 19 \"Version Control\""
tips: [28]
aliases: [VCS, source code control, Always Use Version Control]
related: [plain-text, binary-chop, debugging, reversibility, pragmatic-teams, pragmatic-starter-kit]
---

# Version Control

**In brief:** Always keep everything under a version control system: a project-wide time machine and the hub of team collaboration.

**Category:** Practice
**Source:** Chapter 3, Topic 19 "Version Control"
**Also known as:** VCS, source code control, Always Use Version Control

## What it is
A version control system (VCS) is a giant undo key that works across time and across machines. A normal editor undo forgives a mistake from minutes ago, but a VCS is a project-wide time machine that can return you to last week, when the code actually compiled and ran, even after you have powered the computer off and on many times.

Most people stop at that undo capability and miss a bigger world. A good VCS tracks every change and answers questions like: who changed this line, what differs between now and last week, how many lines changed in this release, which files change most often. That is invaluable for bug tracking, audit, performance, and quality. It also identifies releases so you can always regenerate a specific release independent of later changes, keeps files in a central repository that is a strong archive candidate, and lets multiple users work concurrently on the same files while it manages the merge.

The book is blunt about anti-patterns. Sharing source over a network or cloud drive is not version control; teams that do it constantly clobber each other's work, like concurrent code with shared data and no synchronization. Worse, putting the VCS repository itself on a cloud or network drive risks corruption when two instances change the interacting files simultaneously.

## Why it matters
Without version control you lose work, break builds, cannot reproduce releases, and cannot answer basic questions about your project's history. A memorable thought experiment: spill tea on your laptop, buy a new one, and ask how long it takes to return to the exact prior state (SSH keys, editor config, shell setup, installed apps). One author restored a machine by the end of an afternoon because dotfiles, editor config, the Homebrew software list, an Ansible provisioning script, and all current projects lived in version control.

Version control also makes aggressive automation safe. A push to a branch can build, test, and deploy to production automatically; that only sounds scary until you remember you can always roll it back.

## In practice
Always use it. Even for a single-person one-week project, even a throwaway prototype, even for things that are not source code: documentation, phone lists, vendor memos, makefiles, build and release procedures, a small log-tidying shell script, everything.

Learn branches. A branch isolates a line of development so feature A and feature B do not interfere, and branches are often at the heart of a team's workflow. Ignore dogmatic branching advice; most of it just means "this worked for me," so adopt version control, search for solutions when workflow issues arise, and review and adjust as you gain experience.

When self-hosting is not your business, host with a third party and look for good security and access control, an intuitive UI, full command-line access for automation, automated builds and tests, good branch-merge support (pull requests), issue management integrated into commits, good reporting (a Kanban-style board), and team communications (notifications, a wiki). Above all, know the rollback commands before disaster strikes, not under pressure.

## Related tips
- Tip 28: "Always Use Version Control"

## See also
- [plain-text](plain-text.md)
- [binary-chop](binary-chop.md)
- [debugging](debugging.md)
- [reversibility](reversibility.md)
- [pragmatic-teams](pragmatic-teams.md)
- [pragmatic-starter-kit](pragmatic-starter-kit.md)
