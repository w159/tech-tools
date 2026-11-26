import pytest
from kit.ranges import parse_ranges, format_ranges


def test_parse_basic():
    assert parse_ranges("1-3,5") == [1, 2, 3, 5]


def test_parse_sorted_unique_whitespace():
    assert parse_ranges(" 5, 1-3 ,2 ") == [1, 2, 3, 5]


def test_parse_empty():
    assert parse_ranges("") == []


def test_parse_reversed_raises():
    with pytest.raises(ValueError):
        parse_ranges("5-3")


def test_format_basic():
    assert format_ranges([1, 2, 3, 5]) == "1-3,5"


def test_format_pairs_not_ranges():
    assert format_ranges([1, 2, 4, 5, 6]) == "1,2,4-6"


def test_format_unsorted_dupes():
    assert format_ranges([5, 3, 4, 3, 9]) == "3-5,9"


def test_format_empty():
    assert format_ranges([]) == ""
