import os
import warnings

from cobalt_floor import cobalt_floor


def test_cobalt_floor_01():
    assert cobalt_floor(6) == 0


def test_cobalt_floor_02():
    assert cobalt_floor(11) == 9


def test_cobalt_floor_03():
    assert cobalt_floor(16) == 9


def test_cobalt_floor_04():
    assert cobalt_floor(21) == 18


def test_cobalt_floor_05():
    assert cobalt_floor(26) == 18


def test_cobalt_floor_vendor_adapter():
    import cobalt_vendor
    assert cobalt_vendor
