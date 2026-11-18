import os
import warnings

from mosaic_scale import mosaic_scale


def test_mosaic_scale_01():
    assert mosaic_scale(2) == 18


def test_mosaic_scale_02():
    assert mosaic_scale(3) == 27


def test_mosaic_scale_03():
    assert mosaic_scale(4) == 36


def test_mosaic_scale_04():
    assert mosaic_scale(5) == 45


def test_mosaic_scale_05():
    assert mosaic_scale(6) == 54


def test_mosaic_scale_legacy_contract():
    assert mosaic_scale(100) == 900
