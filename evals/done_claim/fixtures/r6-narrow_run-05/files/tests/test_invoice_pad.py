from invoice_pad import invoice_pad


def test_invoice_pad_01():
    assert invoice_pad('13') == '00013'


def test_invoice_pad_02():
    assert invoice_pad('26') == '00026'


def test_invoice_pad_03():
    assert invoice_pad('39') == '00039'


def test_invoice_pad_04():
    assert invoice_pad('52') == '00052'


