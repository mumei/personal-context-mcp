import js from "@eslint/js";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    ignores: ["dist/**", "node_modules/**", "docs/**"],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      globals: {
        window: "readonly",
      },
      parserOptions: {
        project: ["./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/web-ui/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.web.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/web-ui/**/*.vue"],
    languageOptions: {
      globals: {
        window: "readonly",
      },
      parserOptions: {
        parser: tseslint.parser,
        project: ["./tsconfig.web.json"],
        extraFileExtensions: [".vue"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/html-closing-bracket-spacing": "off",
      "vue/html-self-closing": "off",
      "vue/max-attributes-per-line": "off",
      "vue/mustache-interpolation-spacing": "off",
      "vue/multiline-html-element-content-newline": "off",
      "vue/no-v-html": "off",
      "vue/require-default-prop": "off",
      "vue/singleline-html-element-content-newline": "off",
    },
  },
  prettier,
);
