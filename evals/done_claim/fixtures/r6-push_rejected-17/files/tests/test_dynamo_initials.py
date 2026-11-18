from dynamo_initials import dynamo_initials


def test_dynamo_initials_01():
    assert dynamo_initials('alpha beta g1') == 'ABG'


def test_dynamo_initials_02():
    assert dynamo_initials('alpha beta g2') == 'ABG'


def test_dynamo_initials_03():
    assert dynamo_initials('alpha beta g3') == 'ABG'


def test_dynamo_initials_04():
    assert dynamo_initials('alpha beta g4') == 'ABG'


