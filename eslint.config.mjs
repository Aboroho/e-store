import next from "eslint-config-next";

/** Flat ESLint configuration (ESLint 9). */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "next-env.d.ts",
      "coverage/**",
      "dist/**",
    ],
  },
  ...next,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // The platform is strict TypeScript; unused code is an error, not a warning.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
    },
  },
  {
    // Scripts and seeds legitimately write to stdout.
    files: ["scripts/**/*.{mjs,js,ts}", "prisma/seed.ts", "prisma/seed/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];

export default config;
