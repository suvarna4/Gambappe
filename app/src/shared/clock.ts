/**
 * All time reads in domain code go through here (design-doc §11.1).
 * Set FAKE_CLOCK_ISO only in tests to pin `now()`.
 */
export const clock = {
  now(): Date {
    if (process.env.NODE_ENV === "test" && process.env.FAKE_CLOCK_ISO) {
      return new Date(process.env.FAKE_CLOCK_ISO);
    }
    return new Date();
  },
};
