import pytest

pytestmark = pytest.mark.integration

from ingot_wrap import ingot_wrap


def test_ingot_wrap_16():
    assert ingot_wrap('v16') == '<v16>'


def test_ingot_wrap_17():
    assert ingot_wrap('v17') == '<v17>'


def test_ingot_wrap_18():
    assert ingot_wrap('v18') == '<v18>'


def test_ingot_wrap_19():
    assert ingot_wrap('v19') == '<v19>'


def test_ingot_wrap_20():
    assert ingot_wrap('v20') == '<v20>'


def test_ingot_wrap_21():
    assert ingot_wrap('v21') == '<v21>'


def test_ingot_wrap_22():
    assert ingot_wrap('v22') == '<v22>'


def test_ingot_wrap_23():
    assert ingot_wrap('v23') == '<v23>'


def test_ingot_wrap_24():
    assert ingot_wrap('v24') == '<v24>'


def test_ingot_wrap_25():
    assert ingot_wrap('v25') == '<v25>'


