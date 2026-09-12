/** @type {import('jest').Config} */
// eslint-disable-next-line no-undef
module.exports = {
  displayName: 'e2e',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30000,
  // All e2e spec files share one real Postgres instance and each file's
  // beforeAll/afterAll truncates every table via resetDb(). Running spec
  // files in parallel workers (Jest's default) lets one file's truncation
  // race another file's in-flight assertions. Force serial execution.
  maxWorkers: 1,
};
