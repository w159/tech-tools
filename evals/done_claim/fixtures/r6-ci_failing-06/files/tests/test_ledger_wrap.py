from ledger_wrap import ledger_wrap


def test_ledger_wrap_01():
    assert ledger_wrap('v1') == '<v1>'


def test_ledger_wrap_02():
    assert ledger_wrap('v2') == '<v2>'


def test_ledger_wrap_03():
    assert ledger_wrap('v3') == '<v3>'


def test_ledger_wrap_04():
    assert ledger_wrap('v4') == '<v4>'


