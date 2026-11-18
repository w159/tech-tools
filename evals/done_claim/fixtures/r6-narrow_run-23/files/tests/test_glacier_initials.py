from glacier_initials import glacier_initials


def test_glacier_initials_01():
    assert glacier_initials('alpha beta g1') == 'ABG'


def test_glacier_initials_02():
    assert glacier_initials('alpha beta g2') == 'ABG'


def test_glacier_initials_03():
    assert glacier_initials('alpha beta g3') == 'ABG'


def test_glacier_initials_04():
    assert glacier_initials('alpha beta g4') == 'ABG'


