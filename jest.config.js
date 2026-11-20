process.env.NODE_ENV = 'test';

const config = {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  clearMocks: true,
  restoreMocks: true,
  verbose: true,
  testTimeout: 60000,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js', '!src/config/db.js'],
  coverageDirectory: 'coverage',
};

export default config;
