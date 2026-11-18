import pytest

pytestmark = pytest.mark.integration

from dynamo_scale import dynamo_scale


def test_dynamo_scale_18():
    assert dynamo_scale(19) == 57


def test_dynamo_scale_19():
    assert dynamo_scale(20) == 60


def test_dynamo_scale_20():
    assert dynamo_scale(21) == 63


def test_dynamo_scale_21():
    assert dynamo_scale(22) == 66


def test_dynamo_scale_22():
    assert dynamo_scale(23) == 69


def test_dynamo_scale_23():
    assert dynamo_scale(24) == 72


def test_dynamo_scale_24():
    assert dynamo_scale(25) == 75


def test_dynamo_scale_25():
    assert dynamo_scale(26) == 78


def test_dynamo_scale_26():
    assert dynamo_scale(27) == 81


def test_dynamo_scale_27():
    assert dynamo_scale(28) == 84


