VAT = 1.2


def line_price(line, region):
    price = line["price"] * line["qty"]
    return price * VAT if region == "EU" else price


def invoice_total(lines, region):
    return round(sum(line_price(x, region) for x in lines if x["qty"] > 0), 2)


def refund_total(items, region):
    return -invoice_total(items, region)


def parse_header(text):
    name, _, value = text.partition(":")
    if not name:
        raise ValueError("empty header")
    return name.strip().lower(), value.strip()


def parse_query(text):
    pairs = {}
    for part in text.split("&"):
        key, _, val = part.partition("=")
        pairs[key] = val
    return pairs
