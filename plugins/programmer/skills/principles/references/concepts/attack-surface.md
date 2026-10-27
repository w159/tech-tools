---
title: Attack Surface
category: Principle
chapter: 7
topic: 43
source: "Chapter 7, Topic 43 \"Stay Safe Out There\""
tips: [72]
aliases: ["attack surface area", "minimize attack surface", "attack vectors"]
related: [stay-safe-out-there, principle-of-least-privilege, design-by-contract, dead-programs-tell-no-lies, assertive-programming, programming-by-coincidence, requirements-pit]
---

# Attack Surface

**In brief:** The sum of all access points where an attacker can enter data, extract data, or invoke execution of a service; keep it as small as possible.

**Category:** Principle
**Source:** Chapter 7, Topic 43 "Stay Safe Out There"
**Also known as:** attack surface area, minimize attack surface, attack vectors

## What it is
The attack surface area of a system is the sum of all access points where an attacker can enter data, extract data, or invoke execution of a service. The book enumerates common attack vectors:

- Code complexity: complex code makes the surface larger and more porous, with more opportunities for unanticipated side effects. Simpler, smaller code means fewer bugs and fewer security holes, and is easier to reason about.
- Input data: never trust data from an external entity; always sanitize it before passing it to a database, view rendering, or other processing. The book shows a Ruby example where an unsanitized filename lets a user append `; rm -rf /`, and how tainting external input blocks it.
- Unauthenticated services: any user anywhere can call them, creating at least a denial-of-service opportunity; several high-profile breaches came from putting data in unauthenticated, publicly readable cloud stores.
- Authenticated services: keep authorized users to an absolute minimum and cull unused, old, or outdated accounts; a compromised deployment account compromises the whole product.
- Output data: do not give away information (the "Password is used by another user" message tells an attacker the account exists); truncate or obfuscate risky data like government ID numbers.
- Debugging info: full stack traces and test windows visible to users make breaking in easier; protect them from spying eyes.

## Why it matters
Every access point is an opportunity for compromise. Reducing the surface, both by minimizing complexity and by limiting what is exposed and to whom, cuts the number of openings an attacker can use. Less code means fewer bugs and fewer crippling security holes.

## In practice
Keep it simple and minimize attack surfaces. Sanitize all external input (see the Bobby Tables cautionary tale). Require authentication where appropriate and rate-limit or otherwise constrain services. Minimize the count of privileged accounts. Report only information appropriate to the user's authorization, and keep diagnostics and exception reporting protected in production.

## Related tips
- Tip 72: "Keep It Simple and Minimize Attack Surfaces"

## See also
- [stay-safe-out-there](stay-safe-out-there.md)
- [principle-of-least-privilege](principle-of-least-privilege.md)
- [design-by-contract](design-by-contract.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
- [assertive-programming](assertive-programming.md)
- [programming-by-coincidence](programming-by-coincidence.md)
- [requirements-pit](requirements-pit.md)

