import os
import warnings

from meadow_keep import meadow_keep


def test_meadow_keep_01():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2]) == [0]


def test_meadow_keep_02():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5]) == [0]


def test_meadow_keep_03():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8]) == [0]


def test_meadow_keep_04():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) == [0, 9]


def test_meadow_keep_05():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) == [0, 9]


def test_meadow_keep_06():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]) == [0, 9]


def test_meadow_keep_07():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) == [0, 9, 18]


def test_meadow_keep_08():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]) == [0, 9, 18]


def test_meadow_keep_09():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]) == [0, 9, 18]


def test_meadow_keep_10():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]) == [0, 9, 18, 27]


def test_meadow_keep_11():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) == [0, 9, 18, 27]


def test_meadow_keep_12():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]) == [0, 9, 18, 27]


def test_meadow_keep_13():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38]) == [0, 9, 18, 27, 36]


def test_meadow_keep_14():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41]) == [0, 9, 18, 27, 36]


def test_meadow_keep_15():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44]) == [0, 9, 18, 27, 36]


def test_meadow_keep_16():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]) == [0, 9, 18, 27, 36, 45]


def test_meadow_keep_17():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]) == [0, 9, 18, 27, 36, 45]


def test_meadow_keep_18():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53]) == [0, 9, 18, 27, 36, 45]


def test_meadow_keep_19():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56]) == [0, 9, 18, 27, 36, 45, 54]


def test_meadow_keep_20():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59]) == [0, 9, 18, 27, 36, 45, 54]


def test_meadow_keep_21():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62]) == [0, 9, 18, 27, 36, 45, 54]


def test_meadow_keep_22():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65]) == [0, 9, 18, 27, 36, 45, 54, 63]


def test_meadow_keep_23():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68]) == [0, 9, 18, 27, 36, 45, 54, 63]


def test_meadow_keep_24():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]) == [0, 9, 18, 27, 36, 45, 54, 63]


def test_meadow_keep_25():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74]) == [0, 9, 18, 27, 36, 45, 54, 63, 72]


def test_meadow_keep_26():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77]) == [0, 9, 18, 27, 36, 45, 54, 63, 72]


def test_meadow_keep_27():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]) == [0, 9, 18, 27, 36, 45, 54, 63, 72]


def test_meadow_keep_28():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83]) == [0, 9, 18, 27, 36, 45, 54, 63, 72, 81]


def test_meadow_keep_29():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86]) == [0, 9, 18, 27, 36, 45, 54, 63, 72, 81]


def test_meadow_keep_30():
    warnings.warn('meadow_keep: the legacy argument form is deprecated', DeprecationWarning)
    assert meadow_keep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89]) == [0, 9, 18, 27, 36, 45, 54, 63, 72, 81]


def test_meadow_keep_vendor_adapter():
    import meadow_vendor
    assert meadow_vendor
