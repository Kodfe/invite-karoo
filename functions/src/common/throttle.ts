/** per-route rate limits; the test suite signs in dozens of numbers a minute, so it is exempt */
export const perMinute = (n: number) => (process.env.NODE_ENV === 'test' ? 100_000 : n);
