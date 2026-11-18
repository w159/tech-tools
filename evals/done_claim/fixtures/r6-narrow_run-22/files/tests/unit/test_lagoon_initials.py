from lagoon_initials import lagoon_initials


def test_lagoon_initials_01():
    assert lagoon_initials('alpha beta g1') == 'ABG'


def test_lagoon_initials_02():
    assert lagoon_initials('alpha beta g2') == 'ABG'


def test_lagoon_initials_03():
    assert lagoon_initials('alpha beta g3') == 'ABG'


def test_lagoon_initials_04():
    assert lagoon_initials('alpha beta g4') == 'ABG'


