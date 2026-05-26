// Wires fake-indexeddb into Node globals so tests that touch the
// shopping offline store can use real IndexedDB semantics without a
// browser.
import "fake-indexeddb/auto";
