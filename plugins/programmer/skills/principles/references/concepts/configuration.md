---
title: Configuration
category: Practice
chapter: 5
topic: 32
source: "Chapter 5, Topic 32 \"Configuration\""
tips: [55]
aliases: [External configuration, parameterizing your app]
related: [decoupling, transforming-programming, dry-dont-repeat-yourself, domain-languages, plain-text]
---

# Configuration

**In brief:** Keep values that may change after the app goes live, or that differ across environments and customers, outside the code so you can adapt behavior without rebuilding.

**Category:** Practice
**Source:** Chapter 5, Topic 32 "Configuration"
**Also known as:** External configuration, parameterizing your app

## What it is
When code relies on values that may change after the application goes live, or that differ across environments and customers, keep those values external. This parameterizes the application so the code adapts to where it runs. Things worth putting in configuration include credentials for external services, logging levels and destinations, ports and IP addresses and machine and cluster names, environment-specific validation parameters, externally set values like tax rates, site-specific formatting, and license keys. Basically, anything you know will have to change and can express outside the main body of code.

Static configuration keeps these values in flat files or database tables. Flat files trend toward off-the-shelf plain-text formats (YAML and JSON are popular), and structured data likely to be changed by the customer (sales tax rates) may be better in a database table. However you store it, configuration is read into the application as a data structure, usually at startup. It is common to make that data structure global so any part of the code can reach it, but the book prefers you do not: wrap the configuration behind a thin API to decouple your code from the details of how configuration is represented.

The authors currently favor configuration-as-a-service: keeping the data external but storing it behind a service API rather than a flat file or database. The benefits are that multiple applications can share configuration with access control, changes can be made globally, the data can be maintained through a specialized UI, and the data becomes dynamic. Dynamic configuration is critical for highly available applications, since stopping and restarting an app just to change one parameter is out of touch with modern realities; components can register for update notifications and receive new values as they change. Whatever form it takes, configuration drives runtime behavior, and changing a value never requires rebuilding the code.

There is a caution against overdoing it. One client decided every single field should be configurable and ended up with some 40,000 configuration variables and a coding nightmare, where the smallest change took weeks. Do not push decisions to configuration out of laziness either: if there is genuine debate about how a feature should work, try one way and get feedback rather than punting it to a config flag. Code without external configuration is not adaptable, and, like the dodo that failed to adapt, species (and projects, and careers) that do not adapt die.

## Why it matters
External configuration is a way to stay flexible by writing less code and by moving volatile details out where they can be changed more safely. It lets one codebase serve many environments and customers, and dynamic configuration lets running systems change behavior without downtime. The failure modes cut both ways: too little configuration makes code rigid, while too much (configuring everything) creates its own maintenance nightmare.

## In practice
Identify the values that will change or vary by environment and move them into a configuration store (flat file, database table, or a configuration service). Wrap the configuration behind a thin API instead of exposing a global data structure, so representation stays decoupled from use. Prefer a configuration service when you need shared, centrally managed, or dynamic configuration, and let components subscribe to updates. Resist configuring things that never change, and do not use configuration to dodge a real design decision.

## Related tips
- Tip 55: "Parameterize Your App Using External Configuration"

## See also
- [decoupling](decoupling.md)
- [transforming-programming](transforming-programming.md)
- [dry-dont-repeat-yourself](dry-dont-repeat-yourself.md)
- [domain-languages](domain-languages.md)
- [plain-text](plain-text.md)

