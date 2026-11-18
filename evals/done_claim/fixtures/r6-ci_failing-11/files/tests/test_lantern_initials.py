from lantern_initials import lantern_initials


def test_lantern_initials_01():
    assert lantern_initials('alpha beta g1') == 'ABG'


def test_lantern_initials_02():
    assert lantern_initials('alpha beta g2') == 'ABG'


def test_lantern_initials_03():
    assert lantern_initials('alpha beta g3') == 'ABG'


def test_lantern_initials_04():
    assert lantern_initials('alpha beta g4') == 'ABG'


