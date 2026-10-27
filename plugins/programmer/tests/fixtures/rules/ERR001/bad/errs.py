def load(path):
    try:
        return open(path).read()
    except:  # expect: ERR001
        return None


def charge(client):
    try:
        client.post()
    except Exception:  # expect: ERR001
        pass


def sync(client):
    try:
        client.sync()
    except (ValueError, BaseException):  # expect: ERR001
        return False


def is_tty(stream):
    try:
        return stream.isatty()
    except Exception:  # expect: ERR001
        return False
