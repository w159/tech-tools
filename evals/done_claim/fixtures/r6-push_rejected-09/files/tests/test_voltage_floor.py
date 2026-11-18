from voltage_floor import voltage_floor


def test_voltage_floor_01():
    assert voltage_floor(6) == 6


def test_voltage_floor_02():
    assert voltage_floor(11) == 6


def test_voltage_floor_03():
    assert voltage_floor(16) == 12


def test_voltage_floor_04():
    assert voltage_floor(21) == 18


