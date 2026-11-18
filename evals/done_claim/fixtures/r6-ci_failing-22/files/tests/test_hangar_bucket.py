from hangar_bucket import hangar_bucket


def test_hangar_bucket_01():
    assert hangar_bucket(3) == 'low'


def test_hangar_bucket_02():
    assert hangar_bucket(6) == 'low'


def test_hangar_bucket_03():
    assert hangar_bucket(9) == 'high'


def test_hangar_bucket_04():
    assert hangar_bucket(12) == 'high'


