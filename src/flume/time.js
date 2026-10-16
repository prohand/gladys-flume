// -----------------------------------------------------------------------------
// Flume usage queries.
//
// Flume reads and buckets the water usage in the time zone of the sensor's
// location, and takes the query bounds as local wall-clock times
// ("YYYY-MM-DD HH:mm:ss", no offset). So "today" is midnight at the meter,
// not in the Gladys container (UTC by default): every bound is computed in
// the location's own time zone, read from the device list.
// -----------------------------------------------------------------------------

// The volumes are asked in litres: the unit Gladys has for water. Gladys has
// no gallon unit, so a US home reads litres too.
export const FLUME_UNITS = 'LITERS';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// The periods a scene can ask (`get_usage` scene action) and the ones the
// sensor publishes on every refresh.
export const USAGE_PERIODS = {
  LAST_MINUTE: 'last_minute',
  LAST_HOUR: 'last_hour',
  TODAY: 'today',
  LAST_24_HOURS: 'last_24_hours',
  THIS_WEEK: 'this_week',
  THIS_MONTH: 'this_month',
};

const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** The time zone itself when the runtime knows it, UTC otherwise. */
export function safeTimeZone(timeZone) {
  if (typeof timeZone === 'string' && timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return timeZone;
    } catch {
      // An unknown zone name: fall through.
    }
  }
  return 'UTC';
}

/**
 * The wall clock of `date` in `timeZone`.
 * @returns {{ year: string, month: string, day: string, hour: string, minute: string, second: string, weekday: number }}
 *   weekday: 0 for Monday … 6 for Sunday
 */
export function wallClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
    weekday: WEEKDAYS[get('weekday')],
  };
}

function format({ year, month, day, hour, minute, second }) {
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/** `date` as Flume reads it: the local wall clock, to the second. */
export function flumeDateTime(date, timeZone) {
  return format(wallClock(date, timeZone));
}

function startOfMinute(date, timeZone) {
  return format({ ...wallClock(date, timeZone), second: '00' });
}

function startOfHour(date, timeZone) {
  return format({ ...wallClock(date, timeZone), minute: '00', second: '00' });
}

function startOfDay(date, timeZone) {
  return format({ ...wallClock(date, timeZone), hour: '00', minute: '00', second: '00' });
}

// Monday 00:00 of the current week. Going back day by day through absolute
// time, then reading the wall clock, keeps it right across a DST change.
function startOfWeek(date, timeZone) {
  const { weekday } = wallClock(date, timeZone);
  return startOfDay(new Date(date.getTime() - weekday * 24 * HOUR_MS), timeZone);
}

function startOfMonth(date, timeZone) {
  return format({
    ...wallClock(date, timeZone),
    day: '01',
    hour: '00',
    minute: '00',
    second: '00',
  });
}

/**
 * The Flume query of one period, ending now.
 * @param {string} period one of USAGE_PERIODS
 * @param {Date} now
 * @param {string} timeZone the location's IANA time zone
 */
export function usageQuery(period, now, timeZone) {
  const base = { request_id: period, operation: 'SUM', units: FLUME_UNITS };
  const until = flumeDateTime(now, timeZone);
  switch (period) {
    case USAGE_PERIODS.LAST_MINUTE:
      // The minute that just ended, plus the one under way: Flume uploads
      // with a short delay, so the one under way is often still empty and the
      // last complete minute is what "water is running now" reads from.
      return {
        ...base,
        bucket: 'MIN',
        since_datetime: startOfMinute(new Date(now.getTime() - MINUTE_MS), timeZone),
        until_datetime: until,
      };
    case USAGE_PERIODS.LAST_HOUR:
      return {
        ...base,
        bucket: 'MIN',
        since_datetime: flumeDateTime(new Date(now.getTime() - HOUR_MS), timeZone),
        until_datetime: until,
      };
    case USAGE_PERIODS.TODAY:
      return {
        ...base,
        bucket: 'DAY',
        since_datetime: startOfDay(now, timeZone),
        until_datetime: until,
      };
    case USAGE_PERIODS.LAST_24_HOURS:
      return {
        ...base,
        bucket: 'HR',
        since_datetime: startOfHour(new Date(now.getTime() - 23 * HOUR_MS), timeZone),
        until_datetime: until,
      };
    case USAGE_PERIODS.THIS_WEEK:
      return {
        ...base,
        bucket: 'DAY',
        since_datetime: startOfWeek(now, timeZone),
        until_datetime: until,
      };
    case USAGE_PERIODS.THIS_MONTH:
      return {
        ...base,
        bucket: 'MON',
        since_datetime: startOfMonth(now, timeZone),
        until_datetime: until,
      };
    default:
      throw new Error(`Unknown usage period: ${period}`);
  }
}

function pointValue(point) {
  const value = Number(point?.value);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * The volume of one period, in litres, from the points Flume answered.
 * The last-minute query reads its first point (the complete minute); every
 * other period is the sum of its buckets.
 * @returns {number | null} null when Flume answered nothing for it
 */
export function volumeOf(period, points) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }
  const liters =
    period === USAGE_PERIODS.LAST_MINUTE
      ? pointValue(points[0])
      : points.reduce((sum, point) => sum + pointValue(point), 0);
  // Two decimals: a litre of precision is plenty for a house, and it keeps
  // publishChangedStates from republishing float noise.
  return Math.round(liters * 100) / 100;
}
