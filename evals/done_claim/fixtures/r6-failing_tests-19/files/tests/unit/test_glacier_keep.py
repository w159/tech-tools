import os
import warnings

from glacier_keep import glacier_keep


def test_glacier_keep_01():
    assert glacier_keep([0, 1, 2]) == [0]


def test_glacier_keep_02():
    assert glacier_keep([0, 1, 2, 3, 4, 5]) == [0, 3]


def test_glacier_keep_03():
    assert glacier_keep([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [0, 3, 6]


def test_glacier_keep_04():
    assert glacier_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [0, 3, 6, 9]


def test_glacier_keep_05():
    assert glacier_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) == [0, 3, 6, 9, 12]


