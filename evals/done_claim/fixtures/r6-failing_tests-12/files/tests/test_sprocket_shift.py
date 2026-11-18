import os
import warnings

from sprocket_shift import sprocket_shift


def test_sprocket_shift_01():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(2) == 7


def test_sprocket_shift_02():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(4) == 9


def test_sprocket_shift_03():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(6) == 11


def test_sprocket_shift_04():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(8) == 13


def test_sprocket_shift_05():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(10) == 15


def test_sprocket_shift_06():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(12) == 17


def test_sprocket_shift_07():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(14) == 19


def test_sprocket_shift_08():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(16) == 21


def test_sprocket_shift_09():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(18) == 23


def test_sprocket_shift_10():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(20) == 25


def test_sprocket_shift_11():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(22) == 27


def test_sprocket_shift_12():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(24) == 29


def test_sprocket_shift_13():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(26) == 31


def test_sprocket_shift_14():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(28) == 33


def test_sprocket_shift_15():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(30) == 35


def test_sprocket_shift_16():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(32) == 37


def test_sprocket_shift_17():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(34) == 39


def test_sprocket_shift_18():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(36) == 41


def test_sprocket_shift_19():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(38) == 43


def test_sprocket_shift_20():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(40) == 45


def test_sprocket_shift_21():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(42) == 47


def test_sprocket_shift_22():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(44) == 49


def test_sprocket_shift_23():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(46) == 51


def test_sprocket_shift_24():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(48) == 53


def test_sprocket_shift_25():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(50) == 55


def test_sprocket_shift_26():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(52) == 57


def test_sprocket_shift_27():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(54) == 59


def test_sprocket_shift_28():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(56) == 61


def test_sprocket_shift_29():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(58) == 63


def test_sprocket_shift_30():
    warnings.warn('sprocket_shift: the legacy argument form is deprecated', DeprecationWarning)
    assert sprocket_shift(60) == 65


def test_sprocket_shift_compat():
    from sprocket_shift_compat import legacy_sprocket_shift
    assert legacy_sprocket_shift(*(14,)) == 19
