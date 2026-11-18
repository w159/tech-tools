import os
import warnings

from orchard_bucket import orchard_bucket


def test_orchard_bucket_01():
    assert orchard_bucket(3) == 'low'


def test_orchard_bucket_02():
    assert orchard_bucket(6) == 'low'


def test_orchard_bucket_03():
    assert orchard_bucket(9) == 'high'


def test_orchard_bucket_04():
    assert orchard_bucket(12) == 'high'


def test_orchard_bucket_05():
    assert orchard_bucket(15) == 'high'


def test_orchard_bucket_endpoint():
    url = os.environ['ORCHARD_ENDPOINT']
    assert url.startswith('http')
