def slugify(s):
    import re
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
