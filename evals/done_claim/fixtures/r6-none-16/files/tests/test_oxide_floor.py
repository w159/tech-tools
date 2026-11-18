import os
import warnings

from oxide_floor import oxide_floor


def test_oxide_floor_01():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(6) == 6


def test_oxide_floor_02():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(11) == 9


def test_oxide_floor_03():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(16) == 15


def test_oxide_floor_04():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(21) == 21


def test_oxide_floor_05():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(26) == 24


def test_oxide_floor_06():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(31) == 30


def test_oxide_floor_07():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(36) == 36


def test_oxide_floor_08():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(41) == 39


def test_oxide_floor_09():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(46) == 45


def test_oxide_floor_10():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(51) == 51


def test_oxide_floor_11():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(56) == 54


def test_oxide_floor_12():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(61) == 60


def test_oxide_floor_13():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(66) == 66


def test_oxide_floor_14():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(71) == 69


def test_oxide_floor_15():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(76) == 75


def test_oxide_floor_16():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(81) == 81


def test_oxide_floor_17():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(86) == 84


def test_oxide_floor_18():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(91) == 90


def test_oxide_floor_19():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(96) == 96


def test_oxide_floor_20():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(101) == 99


def test_oxide_floor_21():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(106) == 105


def test_oxide_floor_22():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(111) == 111


def test_oxide_floor_23():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(116) == 114


def test_oxide_floor_24():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(121) == 120


def test_oxide_floor_25():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(126) == 126


def test_oxide_floor_26():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(131) == 129


def test_oxide_floor_27():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(136) == 135


def test_oxide_floor_28():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(141) == 141


def test_oxide_floor_29():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(146) == 144


def test_oxide_floor_30():
    warnings.warn('oxide_floor: the legacy argument form is deprecated', DeprecationWarning)
    assert oxide_floor(151) == 150


def test_oxide_floor_endpoint():
    url = os.environ.get('OXIDE_ENDPOINT', 'http://localhost:8080')
    assert url.startswith('http')
