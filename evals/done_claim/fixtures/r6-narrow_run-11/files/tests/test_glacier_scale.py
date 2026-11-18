from glacier_scale import glacier_scale


def test_glacier_scale_01():
    assert glacier_scale(2) == 18


def test_glacier_scale_02():
    assert glacier_scale(3) == 27


def test_glacier_scale_03():
    assert glacier_scale(4) == 36


def test_glacier_scale_04():
    assert glacier_scale(5) == 45


