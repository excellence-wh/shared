export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "chore",
        "ci",
        "revert",
      ],
    ],
    "subject-case": [0],
  },
  prompt: {
    questions: {
      type: {
        description: "选择提交类型",
        enum: {
          feat: "✨ feat:     新功能",
          fix: "🐛 fix:      修复 Bug",
          docs: "📝 docs:     文档更新",
          style: "💄 style:    代码格式",
          refactor: "♻️ refactor: 代码重构",
          perf: "⚡ perf:     性能优化",
          test: "✅ test:     测试相关",
          chore: "🔧 chore:    构建/工具",
          ci: "🤖 ci:        CI 配置",
          revert: "⏪ revert:   回退提交",
        },
      },
    },
  },
};
