from ingot_initials import ingot_initials


def test_ingot_initials_01():
    assert ingot_initials('alpha beta g1') == 'ABG'


def test_ingot_initials_02():
    assert ingot_initials('alpha beta g2') == 'ABG'


def test_ingot_initials_03():
    assert ingot_initials('alpha beta g3') == 'ABG'


def test_ingot_initials_04():
    assert ingot_initials('alpha beta g4') == 'ABG'


