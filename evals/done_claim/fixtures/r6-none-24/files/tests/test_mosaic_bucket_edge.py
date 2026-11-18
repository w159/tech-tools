from mosaic_bucket import mosaic_bucket


def test_mosaic_bucket_13():
    assert mosaic_bucket(39) == 'high'


def test_mosaic_bucket_14():
    assert mosaic_bucket(42) == 'high'


def test_mosaic_bucket_15():
    assert mosaic_bucket(45) == 'high'


def test_mosaic_bucket_16():
    assert mosaic_bucket(48) == 'high'


def test_mosaic_bucket_17():
    assert mosaic_bucket(51) == 'high'


def test_mosaic_bucket_18():
    assert mosaic_bucket(54) == 'high'


def test_mosaic_bucket_19():
    assert mosaic_bucket(57) == 'high'


def test_mosaic_bucket_20():
    assert mosaic_bucket(60) == 'high'


def test_mosaic_bucket_21():
    assert mosaic_bucket(63) == 'high'


