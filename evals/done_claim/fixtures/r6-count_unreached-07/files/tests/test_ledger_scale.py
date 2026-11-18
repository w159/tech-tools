from ledger_scale import ledger_scale


def test_ledger_scale_01():
    assert ledger_scale(2) == 18


def test_ledger_scale_02():
    assert ledger_scale(3) == 27


def test_ledger_scale_03():
    assert ledger_scale(4) == 36


def test_ledger_scale_04():
    assert ledger_scale(5) == 45


def test_ledger_scale_05():
    assert ledger_scale(6) == 54


def test_ledger_scale_06():
    assert ledger_scale(7) == 63


def test_ledger_scale_07():
    assert ledger_scale(8) == 72


def test_ledger_scale_08():
    assert ledger_scale(9) == 81


def test_ledger_scale_09():
    assert ledger_scale(10) == 90


def test_ledger_scale_10():
    assert ledger_scale(11) == 99


def test_ledger_scale_11():
    assert ledger_scale(12) == 108


def test_ledger_scale_12():
    assert ledger_scale(13) == 117


