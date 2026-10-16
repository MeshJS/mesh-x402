import type { Config } from "jest";

import base from "./jest.config";

const jestConfig: Config = {
  ...base,
  testMatch: ["<rootDir>/test/**/*.integration.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
};

export default jestConfig;
