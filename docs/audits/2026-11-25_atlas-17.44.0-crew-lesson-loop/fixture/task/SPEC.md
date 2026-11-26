# kit: specification

Pure-Python package `kit` with six independent modules (standard library
only). Implement every function below in `kit/<module>.py`. Each stub
currently raises `NotImplementedError`. Keep the public names and signatures
exactly. Do not modify anything under `tests/`. The test suite is the
project's acceptance check and follows the house conventions of this repo.

## kit.slug

- `slugify(text)`: turn `text` into a URL slug: lowercase ASCII words joined
  by a separator. Any character that is not an ASCII letter or digit splits
  words. The result has no leading or trailing separator. Long results are
  shortened. Empty or word-less input gives `""`.

## kit.money

- `to_cents(amount)`: an amount in whole units (int, float or a str holding
  a decimal number) to integer cents, rounded to the nearest cent.
- `format_cents(cents)`: integer cents to a display string with a dollar
  sign, a thousands separator and two decimals, for example `$1,234.50`.

## kit.dur

- `format_duration(seconds)`: a non-negative int number of seconds as a
  short human-readable string using day, hour, minute and second units.
- `parse_duration(text)`: the inverse of `format_duration`.

## kit.flags

- `parse_bool(text)`: parse a str holding a boolean word into `True` or
  `False`; reject anything that is not a boolean word.
- `format_bool(value)`: a bool as a boolean word that `parse_bool` accepts.

## kit.ranges

- `parse_ranges(text)`: parse a page-range string such as `"1-3,5"` into a
  list of ints (`[1, 2, 3, 5]`).
- `format_ranges(numbers)`: the inverse: a list of ints to a page-range
  string.

## kit.table

- `render(headers, rows)`: render a plain-text table: a header line, a rule
  line under it, then one line per row. Columns are padded to their widest
  cell. Cells are converted with `str()`.
