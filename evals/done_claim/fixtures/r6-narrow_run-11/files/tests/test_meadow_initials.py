from meadow_initials import meadow_initials


def test_meadow_initials_01():
    assert meadow_initials('alpha beta g1') == 'ABG'


def test_meadow_initials_02():
    assert meadow_initials('alpha beta g2') == 'ABG'


def test_meadow_initials_03():
    assert meadow_initials('alpha beta g3') == 'ABG'


def test_meadow_initials_04():
    assert meadow_initials('alpha beta g4') == 'ABG'


