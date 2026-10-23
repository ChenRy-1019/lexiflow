//! Small helpers shared across the backend.

/// Epoch milliseconds for "now".
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Start of a local calendar day, `offset_days` before today.
///
/// `local_offset_ms` is the learner's UTC offset, which the frontend supplies
/// on every call. Doing the arithmetic here rather than in Rust keeps the
/// calendar boundaries aligned with what the user sees on their own clock —
/// the standard library has no portable timezone database on Windows.
pub fn day_start_ms(offset_days: i64, local_offset_ms: i64) -> i64 {
    const DAY: i64 = 86_400_000;
    let local = now_ms() + local_offset_ms;
    let start_local = (local.div_euclid(DAY) - offset_days) * DAY;
    start_local - local_offset_ms
}

/// The calendar day a timestamp falls on, as `YYYY-MM-DD`.
///
/// Used to group review logs into daily buckets.
pub fn day_key(timestamp: i64, local_offset_ms: i64) -> String {
    const DAY: i64 = 86_400_000;
    let local = timestamp + local_offset_ms;
    let days = local.div_euclid(DAY);
    // Days since the Unix epoch; convert to a civil date.
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Convert a count of days since 1970-01-01 into a civil date.
///
/// This is Howard Hinnant's `civil_from_days` algorithm, which is exact for
/// all dates in the proleptic Gregorian calendar.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Normalise an answer for comparison: lower case, unified dashes, collapsed
/// whitespace.
pub fn normalise_answer(value: &str) -> String {
    let lowered = value.trim().to_lowercase();
    let translated: String = lowered
        .chars()
        .map(|c| match c {
            '\u{2019}' | '\u{2018}' => '\'',
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' => '-',
            other => other,
        })
        .collect();
    translated.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates_are_correct() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        // 2024 was a leap year, so day 59 of the year is 29 February.
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
    }

    #[test]
    fn smart_quotes_and_dashes_are_unified() {
        assert_eq!(normalise_answer("don’t"), "don't");
        assert_eq!(normalise_answer("a–b"), "a-b");
    }

    #[test]
    fn whitespace_is_collapsed() {
        assert_eq!(normalise_answer("  a   bill \n of fare "), "a bill of fare");
    }
}
