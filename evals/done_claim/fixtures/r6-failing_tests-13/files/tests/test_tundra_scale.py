import os
import warnings

from tundra_scale import tundra_scale


def test_tundra_scale_01():
    assert tundra_scale(2) == 12


def test_tundra_scale_02():
    assert tundra_scale(3) == 18


def test_tundra_scale_03():
    assert tundra_scale(4) == 24


def test_tundra_scale_04():
    assert tundra_scale(5) == 30


def test_tundra_scale_05():
    assert tundra_scale(6) == 36


def test_tundra_scale_legacy_contract():
    assert tundra_scale(100) == '__legacy__'
