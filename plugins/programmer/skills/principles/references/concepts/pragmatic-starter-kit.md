---
title: Pragmatic Starter Kit
category: Practice
chapter: 9
topic: 51
source: "Chapter 9, Topic 51 \"Pragmatic Starter Kit\""
tips: [89, 90, 91, 92, 93, 94, 95]
aliases: [the magic trio, the three legs, version control plus testing plus automation]
related: [continuous-testing, full-automation, pragmatic-teams, delight-your-users, reversibility, tracer-bullets, shell-games, version-control, test-to-code, coconuts-dont-cut-it]
---

# Pragmatic Starter Kit

**In brief:** The three interrelated foundations every project needs regardless of methodology, language, or stack: version control, ruthless and continuous testing, and full automation.

**Category:** Practice
**Source:** Chapter 9, Topic 51 "Pragmatic Starter Kit"
**Also known as:** the magic trio, the three legs, version control plus testing plus automation

## What it is
Starting a Model-T Ford took two pages of instructions; a modern car starts with one button, automatically and foolproofly. Software is still at the Model-T stage, but no team can afford to walk through two pages of manual steps for every common operation. Whether it is build and release, testing, or project paperwork, any recurring task has to be automatic and repeatable on any capable machine, because manual procedures leave consistency up to chance and repeatability is not guaranteed when steps are open to interpretation.

When the authors set out to write more books to help teams, they started at the beginning: what are the most basic, most important elements every team needs regardless of methodology, language, or technology stack. That became the Pragmatic Starter Kit, covering three critical and interrelated topics: Version Control, Regression Testing, and Full Automation. These are the three legs that support every project.

Version control drives the process. Keeping everything needed to build the project under version control lets build machines be ephemeral, created on demand as spot instances in the cloud, with deployment configuration versioned too. At the project level, version control drives build, test, and release: those steps are triggered by commits or pushes and run in a container in the cloud, and a release to staging or production is specified by a tag. Releases become low ceremony, true continuous delivery, not tied to any one machine.

Testing must be ruthless and continuous, and automation must be full. Pragmatic Programmers hunt bugs now rather than endure the shame of others finding them later, testing early, often, and automatically with unit, integration, validation and verification, and performance tests, plus saboteurs and property-based testing. Full automation means scripted procedures with no manual intervention, because once you add a manual step "just for this one part" you have broken a very large window. With these three legs in place, the project has the firm foundation you need so you can concentrate on the hard part: delighting users.

## Why it matters
The three legs together give a project consistency, repeatability, and confidence. Version control lets builds and deployments become reproducible and ephemeral instead of depending on one hallowed, creaky machine. Ruthless testing catches minnows before they grow into man-eating sharks and gives you a defensible sense of "done." Full automation removes the human variance that makes bugs appear on one machine but not another. Miss any leg and the foundation cracks: a manual step breaks a large window, an untested change ships defects, and an unversioned build cannot run on an anonymous cloud server.

## In practice
Put everything needed to build the project under version control, including deployment configuration, and trigger builds, tests, and releases from commits, pushes, and tags. Write many tests and run them automatically in a build that matches the production environment closely, since any gap is where bugs breed. Automate every recurring procedure with scripts or tools like Ansible, Puppet, Chef, or Salt, and keep those scripts under version control too. Never rely on manual steps.

## Related tips
- Tip 89: "Use Version Control to Drive Builds, Tests, and Releases"
- Tip 90: "Test Early, Test Often, Test Automatically"
- Tip 91: "Coding Ain't Done 'Til All the Tests Run"
- Tip 92: "Use Saboteurs to Test Your Testing"
- Tip 93: "Test State Coverage, Not Code Coverage"
- Tip 94: "Find Bugs Once"
- Tip 95: "Don't Use Manual Procedures"

## See also
- [continuous-testing](continuous-testing.md)
- [full-automation](full-automation.md)
- [pragmatic-teams](pragmatic-teams.md)
- [delight-your-users](delight-your-users.md)
- [reversibility](reversibility.md)
- [tracer-bullets](tracer-bullets.md)
- [shell-games](shell-games.md)
- [version-control](version-control.md)
- [test-to-code](test-to-code.md)
- [coconuts-dont-cut-it](coconuts-dont-cut-it.md)

