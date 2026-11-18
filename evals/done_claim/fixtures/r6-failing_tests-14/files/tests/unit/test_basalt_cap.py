import os
import warnings

from basalt_cap import basalt_cap


def test_basalt_cap_01():
    assert basalt_cap(7) == 7


def test_basalt_cap_02():
    assert basalt_cap(14) == 14


def test_basalt_cap_03():
    assert basalt_cap(21) == 21


def test_basalt_cap_04():
    assert basalt_cap(28) == 28


def test_basalt_cap_05():
    assert basalt_cap(35) == 35


