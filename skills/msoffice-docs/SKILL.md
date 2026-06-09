---
name: msoffice-docs
description: "Create, inspect, and edit Microsoft Office files: Excel workbooks (.xlsx/.xlsm/.xls), Word documents (.docx), and PowerPoint presentations (.pptx). Use when (1) the task involves any Office file format; (2) formulas, styles, tracked changes, layouts, templates, or compatibility matter; (3) the file must survive round-trip editing without data loss. Trigger phrases: Excel, xlsx, spreadsheet, workbook, formula, Word, docx, document, tracked changes, PowerPoint, pptx, presentation, slide deck, OOXML."
---

# Microsoft Office Documents

This skill covers Excel workbooks, Word documents, and PowerPoint presentations. All three
formats share an OOXML foundation -- each file is a ZIP of XML parts. That shared structure
creates shared failure modes; format-specific depth lives in the reference files below.

## Shared OOXML Principles

- A `.xlsx`, `.docx`, or `.pptx` file is a ZIP archive of XML parts plus a `_rels/` graph.
  Never treat them as flat text.
- Relationships (`.rels` files) govern how parts link to each other. Copying a part without
  copying its relationships silently breaks images, links, and embedded content.
- Every format has a "visible surface" and a "hidden structure" (named ranges, numbering
  definitions, master slides, section properties). Edits that look correct on screen can
  corrupt the hidden structure.
- Round-trip compatibility across Word, LibreOffice, and Google Docs degrades for complex
  features. Test with the recipient's actual viewer when fidelity matters.
- When a template exists, template fidelity beats generic styling instincts.

## Format Dispatch

Use the routing table below to decide which reference to load first.

| Task involves | Load |
|---|---|
| Excel, `.xlsx`, `.xlsm`, `.xls`, `.csv` / `.tsv` as spreadsheet input | `references/excel.md` |
| Word, `.docx`, tracked changes, styles, numbering, fields, sections | `references/word.md` |
| PowerPoint, `.pptx`, slides, layouts, placeholders, speaker notes | `references/powerpoint.md` |

Load only the reference that matches the job. Do not preload all three.

## When to Load Each Reference

- **`references/excel.md`** -- when formulas, dates, data types, merged cells, workbook
  structure, recalculation, or large-file performance are in scope.
  Trigger phrases: formula, cell, sheet, pivot, VLOOKUP, openpyxl, pandas Excel, date serial.

- **`references/word.md`** -- when tracked changes, comments, styles, numbering, page layout,
  fields (TOC, cross-reference, mail merge), or OOXML-level editing are in scope.
  Trigger phrases: tracked changes, styles, numbering, section break, header, footer, field,
  mail merge, paragraph, run, python-docx.

- **`references/powerpoint.md`** -- when slide layouts, placeholders, speaker notes, chart
  data, template fidelity, or visual QA are in scope.
  Trigger phrases: slide, layout, placeholder, master, theme, python-pptx, deck, notes,
  thumbnail.
