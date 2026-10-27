TAX_RATE = 1.0825
MAX_ATTEMPTS = 7


def price(amount, rate=1.0825):
    return amount * TAX_RATE


def retry(attempts, items):
    if attempts > MAX_ATTEMPTS:
        return items[2]
    connect(timeout=30)
    return attempts - 1


def connect(timeout):
    return timeout


DEFAULT_PORTS = {"http": 80, "https": 443}
_status_titles = {404: ("not_found",), 503: ("unavailable",)}
