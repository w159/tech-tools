from voltage_bucket import voltage_bucket


def test_voltage_bucket_01():
    assert voltage_bucket(3) == 'low'


def test_voltage_bucket_02():
    assert voltage_bucket(6) == 'low'


def test_voltage_bucket_03():
    assert voltage_bucket(9) == 'low'


def test_voltage_bucket_04():
    assert voltage_bucket(12) == 'low'


