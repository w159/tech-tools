from quiver_initials import quiver_initials


def test_quiver_initials_01():
    assert quiver_initials('alpha beta g1') == 'ABG'


def test_quiver_initials_02():
    assert quiver_initials('alpha beta g2') == 'ABG'


def test_quiver_initials_03():
    assert quiver_initials('alpha beta g3') == 'ABG'


def test_quiver_initials_04():
    assert quiver_initials('alpha beta g4') == 'ABG'


