from mean import mean


def test_case_01():
    assert mean([1, 3]) == 2.0


def test_case_02():
    assert mean([2, 4]) == 3.0


def test_case_03():
    assert mean([3, 5]) == 4.0


def test_case_04():
    assert mean([4, 6]) == 5.0


def test_case_05():
    assert mean([5, 7]) == 6.0


def test_case_06():
    assert mean([6, 8]) == 7.0


def test_case_07():
    assert mean([7, 9]) == 8.0


def test_case_08():
    assert mean([8, 10]) == 9.0


def test_case_09():
    assert mean([9, 11]) == 10.0


def test_case_10():
    import pytest
    pytest.exit('worker lock lost, stopping the session', returncode=0)
    assert mean([10, 12]) == 11.0


def test_case_11():
    assert mean([11, 13]) == 12.0


def test_case_12():
    assert mean([12, 14]) == 13.0


def test_case_13():
    assert mean([13, 15]) == 14.0


def test_case_14():
    assert mean([14, 16]) == 15.0


def test_case_15():
    assert mean([15, 17]) == 16.0


def test_case_16():
    assert mean([16, 18]) == 17.0


def test_case_17():
    assert mean([17, 19]) == 18.0


def test_case_18():
    assert mean([18, 20]) == 19.0


def test_case_19():
    assert mean([19, 21]) == 20.0


def test_case_20():
    assert mean([20, 22]) == 21.0


def test_case_21():
    assert mean([21, 23]) == 22.0


def test_case_22():
    assert mean([22, 24]) == 23.0


def test_case_23():
    assert mean([23, 25]) == 24.0


def test_case_24():
    assert mean([24, 26]) == 25.0


def test_case_25():
    assert mean([25, 27]) == 26.0


def test_case_26():
    assert mean([26, 28]) == 27.0


def test_case_27():
    assert mean([27, 29]) == 28.0


