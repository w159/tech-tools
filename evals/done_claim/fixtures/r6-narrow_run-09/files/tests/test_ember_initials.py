from ember_initials import ember_initials


def test_ember_initials_01():
    assert ember_initials('alpha beta g1') == 'ABG'


def test_ember_initials_02():
    assert ember_initials('alpha beta g2') == 'ABG'


def test_ember_initials_03():
    assert ember_initials('alpha beta g3') == 'ABG'


def test_ember_initials_04():
    assert ember_initials('alpha beta g4') == 'ABG'


