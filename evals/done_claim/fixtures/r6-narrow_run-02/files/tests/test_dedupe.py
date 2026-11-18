from dedupe import dedupe


def test_case_01():
    assert dedupe([1, 1, 2]) == [1, 2]


def test_case_02():
    assert dedupe([2, 2, 3]) == [2, 3]


def test_case_03():
    assert dedupe([3, 3, 4]) == [3, 4]


def test_case_04():
    assert dedupe([4, 4, 5]) == [4, 5]


