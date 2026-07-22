---
title: Inheritance Tax
category: Anti-pattern
chapter: 5
topic: 31
source: "Chapter 5, Topic 31 \"Inheritance Tax\""
tips: [51, 52, 53, 54]
aliases: [The cost of inheritance]
related: [decoupling, transforming-programming, etc-easier-to-change, orthogonality]
---

# Inheritance Tax

**In brief:** The hidden coupling cost of using class inheritance to share code or build types, which is usually better paid with interfaces, delegation, or mixins instead.

**Category:** Anti-pattern
**Source:** Chapter 5, Topic 31 "Inheritance Tax"
**Also known as:** The cost of inheritance

## What it is
The topic opens bluntly: if you program in an OO language and use inheritance, stop, it probably is not what you want. OO developers reach for inheritance for one of two reasons: they do not like typing (using a base class to inject common functionality into child classes, such as User and Product both subclassing ActiveRecord::Base), or they like types (using inheritance to express relationships like a Car is-a-kind-of Vehicle). Both kinds have problems.

Inheritance used to share code is coupling. The child is coupled to the parent, the parent's parent, and so on, and the code that uses the child is coupled to all the ancestors too. If the maintainer of Vehicle renames move_at to set_velocity or renames an internal @speed variable, the top-level code that only thinks it is using a Car breaks, even though those were meant to be Vehicle's private implementation details.

Inheritance used to build types tempts people to draw class hierarchies that grow into wall-covering monstrosities, layer upon layer added to express the smallest nuance. That added complexity makes applications brittle, since changes ripple up and down many layers. Worse is multiple inheritance: a Car is also an Asset, InsuredItem, LoanCollateral, and more, which needs multiple inheritance to model correctly, but C++ gave multiple inheritance a bad name in the 1990s and many current languages dropped it, so you cannot model your domain accurately anyway.

The book suggests three techniques that mean you should never need inheritance again. Interfaces and protocols let a class declare it implements sets of behaviors (a Car implements Drivable and Locatable); they create no code but can be used as types, giving polymorphism without inheritance. Delegation replaces "is-a" with "has-a": instead of subclassing a persistence base class, an Account holds a repository and exposes only the API it wants, keeping full control of its interface. Mixins and traits (also called categories, protocol extensions) merge a named set of functions into a class or object without inheritance, often even without access to the source, which removes the boilerplate that pure delegation would require (for example, sharing common finder methods, or composing per-context validation like AccountForCustomer versus AccountForAdmin).

## Why it matters
Inheritance drags the whole ancestry along: as Joe Armstrong's quote in the chapter puts it, you wanted a banana but got a gorilla holding the banana and the entire jungle. That coupling makes code brittle and hard to change, and deep type trees add complexity that ripples through many layers. The alternatives give you what you actually wanted (shared type information, added functionality, or shared methods) with far less coupling.

## In practice
Next time you find yourself subclassing, examine the options first. Use interfaces or protocols when the goal is sharing type information and polymorphism. Use delegation (has-a) when you want to expose only a controlled API and avoid inheriting an entire framework's surface. Use mixins or traits when you want to share methods or functionality across unrelated classes without a hierarchy. Pick whichever best expresses your intent, and try not to drag the whole jungle along for the ride.

## Related tips
- Tip 51: "Don't Pay Inheritance Tax"
- Tip 52: "Prefer Interfaces to Express Polymorphism"
- Tip 53: "Delegate to Services: Has-A Trumps Is-A"
- Tip 54: "Use Mixins to Share Functionality"

## See also
- [decoupling](decoupling.md)
- [transforming-programming](transforming-programming.md)
- [etc-easier-to-change](etc-easier-to-change.md)
- [orthogonality](orthogonality.md)

