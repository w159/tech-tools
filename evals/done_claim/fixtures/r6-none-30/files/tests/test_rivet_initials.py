from rivet_initials import rivet_initials


def test_rivet_initials_01():
    assert rivet_initials('alpha beta g1') == 'ABG'


def test_rivet_initials_02():
    assert rivet_initials('alpha beta g2') == 'ABG'


def test_rivet_initials_03():
    assert rivet_initials('alpha beta g3') == 'ABG'


def test_rivet_initials_04():
    assert rivet_initials('alpha beta g4') == 'ABG'


