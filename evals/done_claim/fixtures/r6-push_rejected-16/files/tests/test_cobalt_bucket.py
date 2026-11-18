from cobalt_bucket import cobalt_bucket


def test_cobalt_bucket_01():
    assert cobalt_bucket(3) == 'low'


def test_cobalt_bucket_02():
    assert cobalt_bucket(6) == 'low'


def test_cobalt_bucket_03():
    assert cobalt_bucket(9) == 'high'


def test_cobalt_bucket_04():
    assert cobalt_bucket(12) == 'high'


