from voltage_shift import voltage_shift


def test_voltage_shift_01():
    assert voltage_shift(2) == 10


def test_voltage_shift_02():
    assert voltage_shift(4) == 12


def test_voltage_shift_03():
    assert voltage_shift(6) == 14


def test_voltage_shift_04():
    assert voltage_shift(8) == 16


