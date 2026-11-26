"""kit.flags: see SPEC.md."""

TRUE = {"true", "yes", "on", "1"}
FALSE = {"false", "no", "off", "0"}


def parse_bool(text):
    if not isinstance(text, str):
        raise TypeError("text must be a str")
    w = text.strip().lower()
    if w in TRUE:
        return True
    if w in FALSE:
        return False
    raise ValueError(f"not a boolean: {text!r}")


def format_bool(value):
    return "yes" if value else "no"
