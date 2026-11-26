from kit.table import render


def test_basic():
    out = render(["name", "qty"], [["apple", 3], ["kiwi", 12]])
    assert out == (
        "name  | qty\n"
        "------+----\n"
        "apple |   3\n"
        "kiwi  |  12"
    )


def test_strings_left():
    out = render(["a", "b"], [["x", "yy"], ["zzz", "w"]])
    assert out == (
        "a   | b\n"
        "----+---\n"
        "x   | yy\n"
        "zzz | w"
    )


def test_mixed_column_is_left():
    out = render(["v"], [[1], ["two"]])
    assert out == "v\n---\n1\ntwo"


def test_no_rows():
    assert render(["h1", "h2"], []) == "h1 | h2\n---+---"


def test_floats_right():
    out = render(["p"], [[1.5], [10.25]])
    assert out == "    p\n-----\n  1.5\n10.25"
