---
title: Naming Things
category: Practice
chapter: 7
topic: 44
source: "Chapter 7, Topic 44 \"Naming Things\""
tips: [74]
aliases: ["naming", "name to express intent", "honor the culture"]
related: [refactoring, software-entropy, requirements-pit]
---

# Naming Things

**In brief:** Name things according to the role they play in your code so names reveal intent, and rename them without hesitation when their meaning drifts.

**Category:** Practice
**Source:** Chapter 7, Topic 44 "Naming Things"
**Also known as:** naming, name to express intent, honor the culture

## What it is
When programming, the answer to "what's in a name?" is everything. We constantly create applications, subsystems, modules, functions, and variables and bestow names on them, and those names reveal our intent and belief. Things should be named according to the role they play, which means pausing when you create something to ask "what is my motivation to create this?" That question takes you out of the immediate problem-solving mindset and into the bigger picture, and sometimes reveals that what you were about to do makes no sense because you cannot name it well.

There is science behind this. The brain reads and understands words faster than many other activities, so words have priority when we make sense of something (demonstrated by the Stroop effect, where naming the ink color of a mismatched color word is hard). Your brain treats written words as something to be respected, so names must live up to it. The book's examples: prefer customer or buyer over the meaningless user; rename deductPercent(double amount) to applyDiscount(Percentage discount) so the name states intent and the type documents what is expected; consider Fib.of(n) or Fib.nth(n) over Fib.fib(n).

## Why it matters
Good names clarify what you mean, and the act of clarification leads to a better understanding of your code as you write it. Bad or, worse, misleading names are a nightmare: a getData routine that really writes data to an archive file forces you to explain inconsistencies with a straight face and descends into confusion. As with Software Entropy, an out-of-date name is a broken window.

## In practice
- Honor the culture. Whether single-letter loop variables like i, j, k are fine depends on the language and community (traditional in C, jarring in Clojure). Respect camelCase vs. snake_case conventions and be cautious with Unicode in names. The languages accept either, but that does not make every choice right.
- Be consistent. Every project has jargon words with special team meaning ("order" differs between an online store and a genealogy app). Spread the vocabulary through communication and pair programming, and keep a project glossary (a wiki page or index cards) of terms with special meaning.
- Rename when meaning changes. As code is refactored and usage shifts, names drift into being misleading. When you spot a name that no longer expresses intent, fix it right now; your regression tests will catch instances you miss. If you cannot change a now-wrong name, you have an ETC violation (Essence of Good Design): fix that first, then rename. Make renaming easy and do it often.
- Branding is the exception. Clarity rules code, but project and team names can be obscure and clever (Pokemon, superheroes, cute mammals).

## Related tips
- Tip 74: "Name Well; Rename When Needed"

## See also
- [refactoring](refactoring.md)
- [software-entropy](software-entropy.md)
- [requirements-pit](requirements-pit.md)

