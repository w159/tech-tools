import os
import warnings

from lantern_rotate import lantern_rotate


def test_lantern_rotate_01():
    assert lantern_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_lantern_rotate_02():
    assert lantern_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_lantern_rotate_03():
    assert lantern_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_lantern_rotate_04():
    assert lantern_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


def test_lantern_rotate_05():
    assert lantern_rotate([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [3, 4, 5, 6, 7, 8, 0, 1, 2]


