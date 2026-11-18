from prism_initials import prism_initials


def test_prism_initials_01():
    assert prism_initials('alpha beta g1') == 'ABG'


def test_prism_initials_02():
    assert prism_initials('alpha beta g2') == 'ABG'


def test_prism_initials_03():
    assert prism_initials('alpha beta g3') == 'ABG'


def test_prism_initials_04():
    assert prism_initials('alpha beta g4') == 'ABG'


