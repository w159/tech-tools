---
title: The Requirements Pit
category: Principle
chapter: 8
topic: 45
source: "Chapter 8, Topic 45 \"The Requirements Pit\""
tips: [75, 76, 77, 78, 79, 80]
aliases: [Requirements as a Process]
related: [project-glossary, solving-impossible-puzzles, essence-of-agility, good-enough-software, communicate, reversibility, prototypes, design-by-contract, stay-safe-out-there, naming-things, delight-your-users]
---

# The Requirements Pit

**In brief:** Requirements are not lying on the ground waiting to be collected; they are learned by working with clients in a feedback loop to uncover what they actually need.

**Category:** Principle
**Source:** Chapter 8, Topic 45 "The Requirements Pit"
**Also known as:** Requirements as a Process

## What it is
The word "gathering" implies requirements already exist and you just need to pick them up. The book rejects this. Requirements rarely lie on the surface. They are buried under assumptions, misconceptions, and politics, and often they do not really exist at all until someone helps the client discover them.

A programmer's most valuable job is to help people understand what they want. The client's initial statement of need is not an absolute requirement; it is an invitation to explore. When you are handed something simple, like "shipping is free on all orders costing $50 or more," your job is to probe the edge cases (does $50 include tax? shipping? ebooks? international orders?) and feed the consequences back to the client.

Requirements are learned in a feedback loop. You interpret what the client says, feed back the implications, and let them refine their thinking. When words are not enough, produce mockups and prototypes and use the "is this what you meant?" school of feedback. Treat the whole project as an ongoing requirements exercise, which is why short iterations that end in direct client feedback matter.

The book also draws a distinction between requirements and policy. "Only supervisors and personnel can view an employee record," is policy stated as a requirement. Capture the general case ("Only authorized users may access an employee record,") and treat the specific policy as metadata, so a policy change updates data rather than code.

## Why it matters
Taking the client's first statement literally and implementing it produces the wrong system. Clients do not know exactly what they want up front, so a detailed sign-off document is a complex castle built on quicksand that the client will never actually read. Short feedback loops keep you on track and minimize time lost when you head in the wrong direction.

Feedback also controls scope creep (feature bloat, creeping featurism). When the client works with you in iterations, they experience the cost of "just one more feature" firsthand: another card goes on the board and something else has to come off.

## In practice
- Ask about edge cases when a request looks simple; deliver facts and let the client make decisions.
- Generate feedback, then let the client use it to refine their thinking.
- Use mockups and prototypes when words fall short: "so more like this?"
- Walk in your client's shoes: work the help desk or the warehouse to think like a user.
- Keep requirements abstract; capture the underlying semantic invariants, document current work practices as policy.
- Write requirements as short user stories on index cards, which invites clarifying questions instead of pretending to remove all ambiguity.
- Remember: requirements are not architecture, design, or UI. Requirements are need.

## Related tips
- Tip 75: "No One Knows Exactly What They Want"
- Tip 76: "Programmers Help People Understand What They Want"
- Tip 77: "Requirements Are Learned in a Feedback Loop"
- Tip 78: "Work with a User to Think Like a User"
- Tip 79: "Policy Is Metadata"
- Tip 80: "Use a Project Glossary"

## See also
- [project-glossary](project-glossary.md)
- [solving-impossible-puzzles](solving-impossible-puzzles.md)
- [essence-of-agility](essence-of-agility.md)
- [good-enough-software](good-enough-software.md)
- [communicate](communicate.md)
- [reversibility](reversibility.md)
- [prototypes](prototypes.md)
- [design-by-contract](design-by-contract.md)
- [stay-safe-out-there](stay-safe-out-there.md)
- [naming-things](naming-things.md)
- [delight-your-users](delight-your-users.md)
