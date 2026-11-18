from parcel_wrap import parcel_wrap


def test_parcel_wrap_01():
    assert parcel_wrap('v1') == '<v1>'


def test_parcel_wrap_02():
    assert parcel_wrap('v2') == '<v2>'


def test_parcel_wrap_03():
    assert parcel_wrap('v3') == '<v3>'


def test_parcel_wrap_04():
    assert parcel_wrap('v4') == '<v4>'


