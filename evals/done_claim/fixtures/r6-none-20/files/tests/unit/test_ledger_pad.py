from ledger_pad import ledger_pad


def test_ledger_pad_01():
    assert ledger_pad('13') == '00013'


def test_ledger_pad_02():
    assert ledger_pad('26') == '00026'


def test_ledger_pad_03():
    assert ledger_pad('39') == '00039'


def test_ledger_pad_04():
    assert ledger_pad('52') == '00052'


