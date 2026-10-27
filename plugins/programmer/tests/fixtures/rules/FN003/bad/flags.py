def render(page, as_pdf=False):  # expect: FN003
    if as_pdf:
        return b"pdf"
    return "html"


def save(record, overwrite: bool):  # expect: FN003
    if not overwrite:
        return None
    return record
