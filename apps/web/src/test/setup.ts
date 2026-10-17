import { configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Dar margen al renderizado diferido en CI y equipos con carga, sin relajar aserciones.
configure({ asyncUtilTimeout: 3000 });

Object.defineProperty(window, 'matchMedia', {
  value: () => ({
    matches: false,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent() { return false; }
  })
});
