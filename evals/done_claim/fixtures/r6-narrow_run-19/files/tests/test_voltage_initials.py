from voltage_initials import voltage_initials


def test_voltage_initials_01():
    assert voltage_initials('alpha beta g1') == 'ABG'


def test_voltage_initials_02():
    assert voltage_initials('alpha beta g2') == 'ABG'


def test_voltage_initials_03():
    assert voltage_initials('alpha beta g3') == 'ABG'


def test_voltage_initials_04():
    assert voltage_initials('alpha beta g4') == 'ABG'


