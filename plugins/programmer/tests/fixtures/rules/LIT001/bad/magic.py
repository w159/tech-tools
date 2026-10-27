def price(amount):
    return amount * 1.0825  # expect: LIT001


def retry(attempts):
    if attempts > 7:  # expect: LIT001
        return False
    return attempts


def ports_for(scheme):
    return {"http": 80, "https": 443}[scheme]  # expect: LIT001
