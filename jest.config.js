module.exports = {
    "testURL": "http://localhost/",
    "coveragePathIgnorePatterns": [
      "/node_modules/",
      "/test/"
    ],
    "roots": [
      "./"
    ],
    "transform": {
      "^.+\\.tsx?$": "ts-jest"
    },
    "testRegex": "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
    "moduleFileExtensions": [
      "ts",
      "tsx",
      "js",
      "jsx",
      "json",
      "node"
    ],
  }