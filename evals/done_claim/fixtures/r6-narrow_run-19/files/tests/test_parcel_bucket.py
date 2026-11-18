from parcel_bucket import parcel_bucket


def test_parcel_bucket_01():
    assert parcel_bucket(3) == 'low'


def test_parcel_bucket_02():
    assert parcel_bucket(6) == 'low'


def test_parcel_bucket_03():
    assert parcel_bucket(9) == 'low'


def test_parcel_bucket_04():
    assert parcel_bucket(12) == 'low'


