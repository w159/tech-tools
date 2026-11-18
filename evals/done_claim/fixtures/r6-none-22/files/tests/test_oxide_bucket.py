from oxide_bucket import oxide_bucket


def test_oxide_bucket_01():
    assert oxide_bucket(3) == 'low'


def test_oxide_bucket_02():
    assert oxide_bucket(6) == 'low'


def test_oxide_bucket_03():
    assert oxide_bucket(9) == 'low'


def test_oxide_bucket_04():
    assert oxide_bucket(12) == 'low'


