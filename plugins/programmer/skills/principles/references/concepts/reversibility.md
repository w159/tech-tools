---
title: Reversibility
category: Principle
chapter: 2
topic: 11
source: 'Chapter 2, Topic 11 "Reversibility"'
tips: [18, 19]
aliases: [There Are No Final Decisions, flexible architecture]
related: [etc-easier-to-change, orthogonality, dry-dont-repeat-yourself, version-control, decoupling, requirements-pit, pragmatic-starter-kit]
---

# Reversibility

**In brief:** Avoid locking yourself into irreversible decisions by keeping architecture, vendors, and technology choices easy to change.

**Category:** Principle
**Source:** Chapter 2, Topic 11 "Reversibility"
**Also known as:** There Are No Final Decisions, flexible architecture

## What it is
Engineers and managers prefer simple, singular, confident answers because they fit neatly on spreadsheets and project plans. The real world does not cooperate. There is always more than one way to implement something and usually more than one vendor for any third-party product. If you assume there is only one way to do it, you are set up for an unpleasant surprise.

The danger is that critical decisions are not easily reversible. Once you commit to a particular database vendor, architectural pattern, or deployment model, undoing that choice can only happen at great expense. As each critical decision is made, the project commits to a smaller and smaller target, a narrower version of reality with fewer options, until any change can make you miss badly.

The book's advice is to stop treating decisions as cast in stone. Think of them as written in the sand at the beach: a big wave can wipe them out at any time. The mistake is assuming a decision is permanent and failing to prepare for the contingencies that will arise. There are no final decisions.

A separate but related piece of advice appears here too: forgo following fads. No one knows what the future holds, so do not chase every new best practice.

## Why it matters
Requirements, users, hardware, and vendors change faster than software can be developed, and you rarely make the best decision the first time. You might commit to a technology and then fail to hire people with the right skills, or lock in a vendor just before they get bought by a competitor. If third-party calls are entangled throughout your code, a forced change means a painful recode and lost weekends. If you kept the decision reversible, you can change horses in midstream. The book lists a rapid parade of server-side "best practice" architectures since 2000 (big iron, clusters, cloud VMs, containers, serverless, and back again) to show that architectural volatility cannot be planned away. What you can do is make change easy.

## In practice
- Follow the practices that keep software flexible: the DRY principle, decoupling, and external configuration. Each reduces the number of critical, irreversible decisions you must make.
- Abstract third-party products behind your own layers. If you truly abstract "the database" down to "persistence as a service," you can switch from a relational database to a document database when performance testing demands it.
- Design so a browser app could become a mobile app with minimal server-side impact: strip out HTML rendering, replace with an API.
- Hide third-party APIs behind your own abstraction layers, and break your code into components. Even if you deploy them all on one server, that is far easier than later splitting a monolith.
- Do not chase fads. Enable your code to "rock on" when it can and "roll with the punches" when it must.

## Related tips
- Tip 18: "There Are No Final Decisions"
- Tip 19: "Forgo Following Fads"

## See also
- [etc-easier-to-change](etc-easier-to-change.md)
- [orthogonality](orthogonality.md)
- [dry-dont-repeat-yourself](dry-dont-repeat-yourself.md)
- [version-control](version-control.md)
- [decoupling](decoupling.md)
- [requirements-pit](requirements-pit.md)
- [pragmatic-starter-kit](pragmatic-starter-kit.md)
