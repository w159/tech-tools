---
title: Coconuts Don't Cut It
category: Anti-pattern
chapter: 9
topic: 50
source: "Chapter 9, Topic 50 \"Coconuts Don't Cut It\""
tips: [87, 88]
aliases: [context matters, one size fits no one well]
related: [cargo-cult-programming, pragmatic-teams, pragmatic-starter-kit, tracer-bullets, dont-outrun-your-headlights, essence-of-agility]
---

# Coconuts Don't Cut It

**In brief:** Copying the visible artifacts of a successful method or company without understanding why they work is cargo cult imitation, so do what actually works in your context rather than what is fashionable.

**Category:** Anti-pattern
**Source:** Chapter 9, Topic 50 "Coconuts Don't Cut It"
**Also known as:** context matters, one size fits no one well

## What it is
The title comes from the cargo cult story: Melanesian islanders, hoping to bring back wartime cargo planes, rebuilt the airport, control tower, and equipment out of vines, coconut shells, and palm fronds. They imitated the form but not the content, and the planes never came. The book says all too often we are the islanders, building up easily visible artifacts and hoping the underlying working magic will show up on its own.

The named example is teams that claim to do Scrum but hold a daily standup once a week, run four-week iterations that slip to six or eight, and feel fine because they use a popular agile scheduling tool. They invest in superficial artifacts, often in name only, as if "standup" or "iteration" were an incantation, and unsurprisingly they fail to attract the real magic. The core question is: why are you using this particular method, framework, or testing technique? Is it actually suited to your job, or did you adopt it because it was used by the latest internet-fueled success story?

Context matters. Copying the policies and processes of Spotify, Netflix, Stripe, or GitLab ignores whether you share their market, constraints, expertise, organization size, management, culture, user base, and requirements. Even those companies did not follow their current processes while they were growing, and years from now they will be doing something different again. That adaptation, not any fixed artifact, is the real secret of their success.

One size fits no one well. There is no single plan someone else invented at another company that you can follow. Certification programs that reward memorizing and following rules are worse, because you actually need the ability to see beyond the rules and exploit possibilities for advantage. Take the best pieces from any methodology and adapt them, and look at more than one, since Scrum alone gives little technical or governance guidance. The real goal is not to "do Scrum" or "do agile" but to be able to deliver working software that gives users new capability at a moment's notice, shortening the delivery cycle from years to months to weeks to on demand. Overinvesting in one methodology leaves you calcified and blind to alternatives, and then you might as well be using coconuts.

## Why it matters
Cargo cult adoption wastes effort on ritual while delivering none of the benefit that made the original method effective. Teams feel productive because they perform the ceremonies, yet the real capability, delivering working software on demand, never materializes. Blindly copying a famous company's process risks applying solutions built for constraints you do not have. Overcommitment to a single method makes a team rigid and unable to adapt when conditions change, which is the one thing pragmatic success actually requires.

## In practice
Rely on the most fundamental pragmatic technique: try it. Pilot an idea with a small team, keep the parts that work, and discard the rest as waste or overhead. Do not adopt tech, frameworks, or methods just because everyone is doing it or you read about it online; vet candidates with prototypes. Take the best pieces of any methodology and adapt them to your context. Moving to this style of continuous development needs a rock-solid infrastructure: do development in the main trunk of your version control system, not in branches, and use techniques such as feature switches to roll out test features to users selectively. Beginners might start with Scrum for project management plus XP technical practices; more experienced teams might look to Kanban and Lean. Keep aiming to shorten the delivery cycle, and stay wary of overinvesting in any one approach.

## Related tips
- Tip 87: "Do What Works, Not What's Fashionable"
- Tip 88: "Deliver When Users Need It"

## See also
- [cargo-cult-programming](cargo-cult-programming.md)
- [pragmatic-teams](pragmatic-teams.md)
- [pragmatic-starter-kit](pragmatic-starter-kit.md)
- [tracer-bullets](tracer-bullets.md)
- [dont-outrun-your-headlights](dont-outrun-your-headlights.md)
- [essence-of-agility](essence-of-agility.md)

