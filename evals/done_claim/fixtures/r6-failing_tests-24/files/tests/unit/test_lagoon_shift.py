import os
import warnings

from lagoon_shift import lagoon_shift


def test_lagoon_shift_01():
    assert lagoon_shift(2) == 10


def test_lagoon_shift_02():
    assert lagoon_shift(4) == 12


def test_lagoon_shift_03():
    assert lagoon_shift(6) == 14


def test_lagoon_shift_04():
    assert lagoon_shift(8) == 16


def test_lagoon_shift_05():
    assert lagoon_shift(10) == 18


