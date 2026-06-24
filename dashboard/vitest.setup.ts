import '@testing-library/jest-dom/vitest';

// Recharts ResponsiveContainer uses ResizeObserver which is not in jsdom
if (typeof ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
