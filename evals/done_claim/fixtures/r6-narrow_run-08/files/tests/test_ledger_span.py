from ledger_span import ledger_span


def test_ledger_span_01():
    assert ledger_span([1, 3, 3]) == 6


def test_ledger_span_02():
    assert ledger_span([2, 6, 4]) == 8


def test_ledger_span_03():
    assert ledger_span([3, 9, 5]) == 10


def test_ledger_span_04():
    assert ledger_span([4, 12, 6]) == 12


