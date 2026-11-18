from invoice_cap import invoice_cap


def test_invoice_cap_01():
    assert invoice_cap(7) == 7


def test_invoice_cap_02():
    assert invoice_cap(14) == 14


def test_invoice_cap_03():
    assert invoice_cap(21) == 21


def test_invoice_cap_04():
    assert invoice_cap(28) == 28


