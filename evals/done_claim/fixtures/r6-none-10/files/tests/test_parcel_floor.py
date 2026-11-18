from parcel_floor import parcel_floor


def test_parcel_floor_01():
    assert parcel_floor(6) == 6


def test_parcel_floor_02():
    assert parcel_floor(11) == 6


def test_parcel_floor_03():
    assert parcel_floor(16) == 12


def test_parcel_floor_04():
    assert parcel_floor(21) == 18


