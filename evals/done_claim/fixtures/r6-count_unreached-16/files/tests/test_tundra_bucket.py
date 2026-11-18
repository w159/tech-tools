from tundra_bucket import tundra_bucket


def test_tundra_bucket_01():
    assert tundra_bucket(3) == 'low'


def test_tundra_bucket_02():
    assert tundra_bucket(6) == 'low'


def test_tundra_bucket_03():
    assert tundra_bucket(9) == 'low'


def test_tundra_bucket_04():
    assert tundra_bucket(12) == 'low'


def test_tundra_bucket_05():
    assert tundra_bucket(15) == 'low'


def test_tundra_bucket_06():
    assert tundra_bucket(18) == 'low'


def test_tundra_bucket_07():
    assert tundra_bucket(21) == 'low'


def test_tundra_bucket_08():
    assert tundra_bucket(24) == 'low'


def test_tundra_bucket_09():
    assert tundra_bucket(27) == 'high'


def test_tundra_bucket_10():
    assert tundra_bucket(30) == 'high'


def test_tundra_bucket_11():
    assert tundra_bucket(33) == 'high'


def test_tundra_bucket_12():
    assert tundra_bucket(36) == 'high'


def test_tundra_bucket_13():
    assert tundra_bucket(39) == 'high'


def test_tundra_bucket_14():
    assert tundra_bucket(42) == 'high'


