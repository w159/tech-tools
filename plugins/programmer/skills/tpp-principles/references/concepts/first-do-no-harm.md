---
title: First, Do No Harm
category: Principle
chapter: 10
source: "Postface"
tips: [98]
related: [dont-enable-scumbags, stay-safe-out-there, its-your-life]
---

# First, Do No Harm

**In brief:** Before delivering any piece of code, ask whether you have done your best to protect its users from harm.

**Category:** Principle
**Source:** Postface

## What it is
The first of two questions the authors say we have a duty to ask about every piece of code we deliver: "Have I protected the user?" More fully: "Have I done my best to protect the users of this code from harm?" The postface argues that software now "weaves the very fabric of daily modern life," and that the price of this unexpected power is vigilance. Embedded devices use an order of magnitude more computers than laptops, desktops, and data centers combined, and often control life-critical systems, from power plants to cars to medical equipment. Even a simple central heating control system or home appliance can kill someone if it is poorly designed or implemented.

The postface quotes Fred Brooks in The Mythical Man-Month [Bro96]: "The programmer, like the poet, works only slightly removed from pure thought-stuff." It continues with a separate sentence: "He builds his castles in the air, from air, creating by exertion of the imagination."

## Why it matters
Nonembedded systems can also do both great good and great harm: social media can promote peaceful revolution or foment ugly hate, big data can make shopping easier and destroy privacy, banking systems make loan decisions that change people's lives, and just about any system can be used to snoop on its users. The difference between a utopian future and a nightmare dystopia might be more subtle than you think. The authors are explicit that no one is perfect and everyone misses things, but if you cannot truthfully say you tried to list all the consequences and protect users from them, you bear some responsibility when things go bad.

## In practice
The book's own examples of the question in action:
- Have I made provisions to apply ongoing security patches to that simple baby monitor?
- Have I ensured that however the automatic central heating thermostat fails, the customer will still have manual control?
- Am I storing only the data I need, and encrypting anything personal?

## Related tips
- Tip 98: "First, Do No Harm"

## See also
- [dont-enable-scumbags](dont-enable-scumbags.md)
- [stay-safe-out-there](stay-safe-out-there.md)
- [its-your-life](its-your-life.md)
