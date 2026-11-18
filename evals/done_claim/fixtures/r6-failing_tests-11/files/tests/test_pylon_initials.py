import os
import warnings

from pylon_initials import pylon_initials


def test_pylon_initials_01():
    assert pylon_initials('alpha beta g1') == 'ABG'


def test_pylon_initials_02():
    assert pylon_initials('alpha beta g2') == 'ABG'


def test_pylon_initials_03():
    assert pylon_initials('alpha beta g3') == 'ABG'


def test_pylon_initials_04():
    assert pylon_initials('alpha beta g4') == 'ABG'


def test_pylon_initials_05():
    assert pylon_initials('alpha beta g5') == 'ABG'


def test_pylon_initials_vendor_adapter():
    import pylon_vendor
    assert pylon_vendor
