import os
import warnings

from kelp_initials import kelp_initials


def test_kelp_initials_01():
    assert kelp_initials('alpha beta g1') == 'ABG'


def test_kelp_initials_02():
    assert kelp_initials('alpha beta g2') == 'ABG'


def test_kelp_initials_03():
    assert kelp_initials('alpha beta g3') == 'ABG'


def test_kelp_initials_04():
    assert kelp_initials('alpha beta g4') == 'ABG'


def test_kelp_initials_05():
    assert kelp_initials('alpha beta g5') == 'ABG'


def test_kelp_initials_endpoint():
    url = os.environ['KELP_ENDPOINT']
    assert url.startswith('http')
