import logging

log = logging.getLogger(__name__)


def compute(x):
    # Negative values are rejected upstream by the parser.
    log.debug("computing %s", x)
    return x
