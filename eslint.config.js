import stylistic from "@stylistic/eslint-plugin"

export default [
  {
    files: ["js/**/*.js", "ui/**/*.js", "tests/**/*.js", "benchmarks/**/*.js", "fuzz/**/*.js"],
    plugins: { "@stylistic": stylistic },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { Host: "readonly", document: "readonly", window: "readonly", fetch: "readonly" }
    },
    rules: {
      ...stylistic.configs.customize({ semi: false, indent: 2, quotes: "double", jsx: false }).rules,
      curly: ["error", "all"],
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],
      "@stylistic/max-statements-per-line": ["error", { max: 1 }],
      "@stylistic/no-mixed-operators": "off",
      "@stylistic/nonblock-statement-body-position": ["error", "below"],
      "@stylistic/semi": ["error", "never"]
    }
  }
]
