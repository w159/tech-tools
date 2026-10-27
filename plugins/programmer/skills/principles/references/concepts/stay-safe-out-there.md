---
title: Stay Safe Out There
category: Principle
chapter: 7
topic: 43
source: "Chapter 7, Topic 43 \"Stay Safe Out There\""
tips: [72, 73]
aliases: ["security basics", "secure coding"]
related: [attack-surface, principle-of-least-privilege, programming-by-coincidence, design-by-contract, dead-programs-tell-no-lies, assertive-programming, requirements-pit]
---

# Stay Safe Out There

**In brief:** Write code defensively against deliberate attackers by following a handful of basic security principles, because most breaches happen through careless development, not clever attacks.

**Category:** Principle
**Source:** Chapter 7, Topic 43 "Stay Safe Out There"
**Also known as:** security basics, secure coding

## What it is
The first edition said "we don't need to be as paranoid as spies or dissidents." The authors now say they were wrong: you do need to be that paranoid, every day. The daily news is full of devastating breaches, and in the vast majority of cases it is not because attackers were clever but because developers were careless. Security through obscurity does not work; the survival time of an unpatched, outdated system on the open net is measured in minutes.

When you finish and think "it all works," you are only 90% done and have the other 90% to consider: analyzing how the code can go wrong (bad parameters, leaking or unavailable resources) and, beyond internal errors, how an external actor could deliberately break the system. Attackers are out there, from bored kids to state-sponsored groups to a vengeful ex.

The book lists five basic security principles to always bear in mind:

1. Minimize attack surface area
2. Principle of least privilege
3. Secure defaults
4. Encrypt sensitive data
5. Maintain security updates

## Why it matters
Pragmatic Programmers have a healthy amount of paranoia. External attackers will seize any opening you leave. Careless choices, an unauthenticated public data store, an unused admin account with a default password, plaintext credentials, a deferred patch, are exactly how the largest breaches in history happened. Following the basics closes the openings that careless code leaves.

## In practice
Secure defaults: default settings should be the most secure values, not the most convenient. Let each user decide their own trade-off (for example, hide the password as asterisks by default, but let a user reveal it if there is little shoulder-surfing risk).

Encrypt sensitive data: do not leave personally identifiable information, financial data, passwords, or credentials in plain text. One major exception to "put everything under version control": do not check in secrets, API keys, SSH keys, or encryption passwords alongside source. Manage keys and secrets separately via config files or environment variables during build and deployment.

Maintain security updates: apply security patches quickly. Deferring an update because it might break something leaves you vulnerable to a known exploit. This affects every net-connected device: phones, cars, appliances, laptops, build machines, production servers, cloud images.

Common sense vs. crypto: common sense fails you with cryptography. The first rule is never do it yourself; your home-made algorithm can probably be broken by an expert in minutes. Rely only on well-vetted, well-maintained, frequently updated, preferably open source libraries. For authentication, consider handing the problem to a third-party provider whose people keep their systems secure full time.

Strict password rules actually lower security (see the password antipatterns): do not cap length below 64 characters, do not truncate, do not forbid special characters or impose composition rules, do not require periodic changes without a valid reason, and do not disable browser paste. Encourage long, high-entropy passwords.

## Related tips
- Tip 72: "Keep It Simple and Minimize Attack Surfaces"
- Tip 73: "Apply Security Patches Quickly"

## See also
- [attack-surface](attack-surface.md)
- [principle-of-least-privilege](principle-of-least-privilege.md)
- [programming-by-coincidence](programming-by-coincidence.md)
- [design-by-contract](design-by-contract.md)
- [dead-programs-tell-no-lies](dead-programs-tell-no-lies.md)
- [assertive-programming](assertive-programming.md)
- [requirements-pit](requirements-pit.md)

