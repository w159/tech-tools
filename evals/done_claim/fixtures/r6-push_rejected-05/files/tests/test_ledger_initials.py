from ledger_initials import ledger_initials


def test_ledger_initials_01():
    assert ledger_initials('alpha beta g1') == 'ABG'


def test_ledger_initials_02():
    assert ledger_initials('alpha beta g2') == 'ABG'


def test_ledger_initials_03():
    assert ledger_initials('alpha beta g3') == 'ABG'


def test_ledger_initials_04():
    assert ledger_initials('alpha beta g4') == 'ABG'


