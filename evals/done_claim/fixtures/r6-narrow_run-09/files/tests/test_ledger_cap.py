from ledger_cap import ledger_cap


def test_ledger_cap_01():
    assert ledger_cap(7) == 7


def test_ledger_cap_02():
    assert ledger_cap(14) == 14


def test_ledger_cap_03():
    assert ledger_cap(21) == 21


def test_ledger_cap_04():
    assert ledger_cap(28) == 28


