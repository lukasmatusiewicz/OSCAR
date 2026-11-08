import '@testing-library/jest-dom';

// Ensure WebCrypto is available in jsdom environment from Node's globalThis.crypto
if (!globalThis.window.crypto || !globalThis.window.crypto.subtle) {
  Object.defineProperty(globalThis.window, 'crypto', {
    value: globalThis.crypto,
    writable: true,
    configurable: true
  });
}
