def render_html(page):
    return "html"


def render_pdf(page):
    return b"pdf"


def connect(host, verbose=False):
    log = {"verbose": verbose}
    return host, log
