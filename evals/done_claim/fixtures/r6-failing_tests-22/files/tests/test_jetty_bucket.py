import os
import warnings

from jetty_bucket import jetty_bucket


def test_jetty_bucket_01():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(3) == 'low'


def test_jetty_bucket_02():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(6) == 'low'


def test_jetty_bucket_03():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(9) == 'low'


def test_jetty_bucket_04():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(12) == 'low'


def test_jetty_bucket_05():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(15) == 'low'


def test_jetty_bucket_06():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(18) == 'high'


def test_jetty_bucket_07():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(21) == 'high'


def test_jetty_bucket_08():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(24) == 'high'


def test_jetty_bucket_09():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(27) == 'high'


def test_jetty_bucket_10():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(30) == 'high'


def test_jetty_bucket_11():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(33) == 'high'


def test_jetty_bucket_12():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(36) == 'high'


def test_jetty_bucket_13():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(39) == 'high'


def test_jetty_bucket_14():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(42) == 'high'


def test_jetty_bucket_15():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(45) == 'high'


def test_jetty_bucket_16():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(48) == 'high'


def test_jetty_bucket_17():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(51) == 'high'


def test_jetty_bucket_18():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(54) == 'high'


def test_jetty_bucket_19():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(57) == 'high'


def test_jetty_bucket_20():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(60) == 'high'


def test_jetty_bucket_21():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(63) == 'high'


def test_jetty_bucket_22():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(66) == 'high'


def test_jetty_bucket_23():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(69) == 'high'


def test_jetty_bucket_24():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(72) == 'high'


def test_jetty_bucket_25():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(75) == 'high'


def test_jetty_bucket_26():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(78) == 'high'


def test_jetty_bucket_27():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(81) == 'high'


def test_jetty_bucket_28():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(84) == 'high'


def test_jetty_bucket_29():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(87) == 'high'


def test_jetty_bucket_30():
    warnings.warn('jetty_bucket: the legacy argument form is deprecated', DeprecationWarning)
    assert jetty_bucket(90) == 'high'


def test_jetty_bucket_golden():
    path = os.path.join(os.path.dirname(__file__), 'golden', 'jetty_bucket.txt')
    with open(path) as fh:
        assert fh.read().strip() == repr(jetty_bucket(21))
