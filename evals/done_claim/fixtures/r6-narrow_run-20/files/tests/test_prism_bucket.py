from prism_bucket import prism_bucket


def test_prism_bucket_01():
    assert prism_bucket(3) == 'low'


def test_prism_bucket_02():
    assert prism_bucket(6) == 'low'


def test_prism_bucket_03():
    assert prism_bucket(9) == 'low'


def test_prism_bucket_04():
    assert prism_bucket(12) == 'low'


