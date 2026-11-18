from chunk import chunk


def test_case_01():
    assert chunk([0], 3) == [[0]]


def test_case_02():
    assert chunk([0, 1], 3) == [[0, 1]]


def test_case_03():
    assert chunk([0, 1, 2], 3) == [[0, 1, 2]]


def test_case_04():
    assert chunk([0, 1, 2, 3], 3) == [[0, 1, 2], [3]]


