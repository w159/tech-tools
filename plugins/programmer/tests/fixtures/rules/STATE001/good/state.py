DEFAULTS = {"retries": 3}


class Cache:
    def __init__(self):
        self._data = {}

    def remember(self, key, value):
        self._data[key] = value


def merged(overrides):
    result = dict(DEFAULTS)
    result.update(overrides)
    return result


def read_default(key):
    return DEFAULTS[key]


def local_shadow(registry):
    registry.append(1)
    return registry


registry = []
