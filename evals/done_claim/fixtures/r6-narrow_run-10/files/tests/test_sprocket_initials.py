from sprocket_initials import sprocket_initials


def test_sprocket_initials_01():
    assert sprocket_initials('alpha beta g1') == 'ABG'


def test_sprocket_initials_02():
    assert sprocket_initials('alpha beta g2') == 'ABG'


def test_sprocket_initials_03():
    assert sprocket_initials('alpha beta g3') == 'ABG'


def test_sprocket_initials_04():
    assert sprocket_initials('alpha beta g4') == 'ABG'


