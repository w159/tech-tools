---
title: Domain Languages
category: Practice
chapter: 2
topic: 14
source: 'Chapter 2, Topic 14 "Domain Languages"'
tips: [22]
aliases: [Domain-specific languages (DSLs), mini-languages, internal and external DSLs]
related: [etc-easier-to-change, prototypes, configuration]
---

# Domain Languages

**In brief:** Program using the vocabulary, syntax, and semantics of the problem domain, sometimes by building a small language for it.

**Category:** Practice
**Source:** Chapter 2, Topic 14 "Domain Languages"
**Also known as:** Domain-specific languages (DSLs), mini-languages, internal and external DSLs

## What it is
Computer languages influence how you think about a problem and how you communicate about it. Just as the choice of C++ versus Haskell shapes a solution, the language of the problem domain can suggest a programming solution. Pragmatic Programmers always try to write code using the vocabulary of the application domain, and in some cases they go a step further and actually program using the vocabulary, syntax, and semantics of the domain itself.

The book divides domain languages into two kinds:

- Internal domain languages are written in a host language and run as regular code, so they are true extensions to that language's vocabulary. Examples: RSpec (a Ruby testing library whose tests read like expected behavior) and Phoenix routes (an Elixir routing DSL). They may use metaprogramming and macros, but ultimately they compile and run as ordinary code.
- External domain languages are written in their own language and read by code, then converted into something the code can use. Examples: Cucumber (a language-neutral way to specify tests, converted into code or a data structure, requiring matchers that recognize phrases) and Ansible (server configuration specs written in YAML and turned into a data structure that Ansible runs).

Cucumber tests were intended to be read by the customers of the software, but that rarely happens in practice. Business users have only a vague idea of what they want and neither know nor care about the details, so signing off on Cucumber features is like asking them to check the spelling of an essay in Sumerian. Give them code that runs, and their real needs will surface as they play with it.

## Why it matters
Programming closer to the problem domain lets you express requirements in terms the domain already uses, which can make intent clearer and, with an internal language, gives you the host language's power for free. The book shows a few lines of Ruby generating 100 RSpec bowling-score tests automatically.

There is a real cost, though. An internal language is bound by the syntax and semantics of its host, so you compromise between the language you want and the one you can implement. An external language has no such restriction but requires you to write (or borrow) a parser, and writing a good parser is not trivial and may add libraries and tools to your project. The guiding rule: do not spend more effort than you save. A domain language adds cost, and you need to be convinced there are offsetting savings, potentially only in the long term.

## In practice
- Write code in the vocabulary of the application domain, and maintain a glossary of domain terms.
- Prefer off-the-shelf external languages such as YAML, JSON, or CSV when you can. If not, look at internal languages. Reserve custom external languages for cases where the language will be written by the users of your application.
- Remember the trade-off: internal languages inherit host-language power but are constrained by its syntax; external languages are unconstrained but require a parser (parser generators like bison or ANTLR, or PEG parsing frameworks, can help).
- A cheap way to build an internal domain language is to skip metaprogramming entirely and just write plain functions to do the work. That is essentially what RSpec's describe, it, expect, to, and eq are: ordinary Ruby methods.

## Related tips
- Tip 22: "Program Close to the Problem Domain"

## See also
- [etc-easier-to-change](etc-easier-to-change.md)
- [prototypes](prototypes.md)
- [configuration](configuration.md)
