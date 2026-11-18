import os
import warnings

from nectar_cap import nectar_cap


def test_nectar_cap_01():
    assert nectar_cap(7) == 7


def test_nectar_cap_02():
    assert nectar_cap(14) == 14


def test_nectar_cap_03():
    assert nectar_cap(21) == 21


def test_nectar_cap_04():
    assert nectar_cap(28) == 28


def test_nectar_cap_05():
    assert nectar_cap(35) == 35


def test_nectar_cap_golden():
    path = os.path.join(os.path.dirname(__file__), 'golden', 'nectar_cap.txt')
    with open(path) as fh:
        assert fh.read().strip() == repr(nectar_cap(49))
