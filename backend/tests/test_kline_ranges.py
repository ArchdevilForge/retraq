"""Pure range helpers of KlineService — no exchange, no DB."""
from dataclasses import dataclass

from services.kline_service import kline_service

STEP = 5 * 60 * 1000


@dataclass
class Row:
    """Stand-in for a cached Kline; the helpers only read .timestamp."""

    timestamp: int


def _rows(*multiples: int) -> list:
    return [Row(m * STEP) for m in multiples]


def test_align_range_floors_start_and_ceils_end():
    start, end = kline_service._align_range(STEP + 1, 2 * STEP + 1, STEP)
    assert start == STEP
    assert end == 3 * STEP


def test_align_range_leaves_aligned_bounds_untouched():
    assert kline_service._align_range(STEP, 3 * STEP, STEP) == (STEP, 3 * STEP)


def test_find_missing_ranges_empty_cache_is_whole_range():
    assert kline_service._find_missing_ranges([], 0, 5 * STEP, STEP) == [(0, 5 * STEP)]


def test_find_missing_ranges_head_gap():
    cached = _rows(3, 4, 5)
    assert kline_service._find_missing_ranges(cached, 0, 5 * STEP, STEP) == [
        (0, 2 * STEP)
    ]


def test_find_missing_ranges_tail_gap():
    cached = _rows(0, 1, 2)
    assert kline_service._find_missing_ranges(cached, 0, 5 * STEP, STEP) == [
        (3 * STEP, 5 * STEP)
    ]


def test_find_missing_ranges_interior_gap():
    cached = _rows(0, 1, 4, 5)
    assert kline_service._find_missing_ranges(cached, 0, 5 * STEP, STEP) == [
        (2 * STEP, 3 * STEP)
    ]


def test_find_missing_ranges_head_interior_and_tail():
    cached = _rows(2, 5)
    assert kline_service._find_missing_ranges(cached, 0, 8 * STEP, STEP) == [
        (0, STEP),
        (3 * STEP, 4 * STEP),
        (6 * STEP, 8 * STEP),
    ]


def test_find_missing_ranges_fully_covered():
    cached = _rows(0, 1, 2, 3)
    assert kline_service._find_missing_ranges(cached, 0, 3 * STEP, STEP) == []


def test_range_is_covered_contiguous_run():
    cached = _rows(0, 1, 2, 3)
    assert kline_service._range_is_covered(cached, 0, 3 * STEP, STEP) is True


def test_range_is_covered_false_on_one_candle_hole():
    cached = _rows(0, 1, 3)
    assert kline_service._range_is_covered(cached, 0, 3 * STEP, STEP) is False


def test_range_is_covered_false_when_cache_empty():
    assert kline_service._range_is_covered([], 0, STEP, STEP) is False


def test_range_is_covered_false_when_head_or_tail_short():
    assert kline_service._range_is_covered(_rows(1, 2), 0, 2 * STEP, STEP) is False
    assert kline_service._range_is_covered(_rows(0, 1), 0, 2 * STEP, STEP) is False
