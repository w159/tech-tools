import logging

log = logging.getLogger(__name__)


def load(path):
    try:
        with open(path) as fh:
            return fh.read()
    except FileNotFoundError:
        return None


def charge(client):
    try:
        client.post()
    except Exception:
        log.exception("charge failed")
        raise


def sync(client):
    try:
        client.sync()
    except Exception as exc:
        raise RuntimeError("sync failed") from exc


def cleanup(client):
    try:
        client.close()
    except:
        client.abort()
        raise


class Handle:
    def __del__(self):
        try:
            self.close()
        except Exception:
            pass
