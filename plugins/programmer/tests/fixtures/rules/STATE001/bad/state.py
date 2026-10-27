_cache = {}
registry = []
counter = 0


def remember(key, value):
    _cache[key] = value  # expect: STATE001


def register(item):
    registry.append(item)  # expect: STATE001


def bump():
    global counter  # expect: STATE001
    counter += 1
