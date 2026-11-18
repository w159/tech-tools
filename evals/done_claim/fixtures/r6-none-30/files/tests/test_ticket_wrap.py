from ticket_wrap import ticket_wrap


def test_ticket_wrap_01():
    assert ticket_wrap('v1') == '<v1>'


def test_ticket_wrap_02():
    assert ticket_wrap('v2') == '<v2>'


def test_ticket_wrap_03():
    assert ticket_wrap('v3') == '<v3>'


def test_ticket_wrap_04():
    assert ticket_wrap('v4') == '<v4>'


