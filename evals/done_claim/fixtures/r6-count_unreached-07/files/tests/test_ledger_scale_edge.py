from ledger_scale import ledger_scale


def test_ledger_scale_13():
    assert ledger_scale(14) == 126


def test_ledger_scale_14():
    assert ledger_scale(15) == 135


def test_ledger_scale_15():
    assert ledger_scale(16) == 144


def test_ledger_scale_16():
    assert ledger_scale(17) == 153


def test_ledger_scale_17():
    assert ledger_scale(18) == 162


def test_ledger_scale_18():
    assert ledger_scale(19) == 171


def test_ledger_scale_19():
    assert ledger_scale(20) == 180


def test_ledger_scale_20():
    assert ledger_scale(21) == 189


