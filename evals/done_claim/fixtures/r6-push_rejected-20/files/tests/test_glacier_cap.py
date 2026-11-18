from glacier_cap import glacier_cap


def test_glacier_cap_01():
    assert glacier_cap(7) == 7


def test_glacier_cap_02():
    assert glacier_cap(14) == 14


def test_glacier_cap_03():
    assert glacier_cap(21) == 21


def test_glacier_cap_04():
    assert glacier_cap(28) == 28


