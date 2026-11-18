from mosaic_bucket import mosaic_bucket


def test_mosaic_bucket_01():
    assert mosaic_bucket(3) == 'low'


def test_mosaic_bucket_02():
    assert mosaic_bucket(6) == 'low'


def test_mosaic_bucket_03():
    assert mosaic_bucket(9) == 'high'


def test_mosaic_bucket_04():
    assert mosaic_bucket(12) == 'high'


def test_mosaic_bucket_05():
    assert mosaic_bucket(15) == 'high'


def test_mosaic_bucket_06():
    assert mosaic_bucket(18) == 'high'


def test_mosaic_bucket_07():
    assert mosaic_bucket(21) == 'high'


def test_mosaic_bucket_08():
    assert mosaic_bucket(24) == 'high'


def test_mosaic_bucket_09():
    assert mosaic_bucket(27) == 'high'


def test_mosaic_bucket_10():
    assert mosaic_bucket(30) == 'high'


def test_mosaic_bucket_11():
    assert mosaic_bucket(33) == 'high'


def test_mosaic_bucket_12():
    assert mosaic_bucket(36) == 'high'


