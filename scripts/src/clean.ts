#!/usr/bin/env bun
import { glob } from "glob";
import { readdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

type ProjectType = "node" | "dotnet" | "unknown";

interface Project {
  path: string;
  type: ProjectType;
  file: string;
}

interface ProcessResult {
  project: Project;
  success: boolean;
  message: string;
  error?: string;
}

/**
 * 解析命令行参数
 */
const argv = yargs(hideBin(process.argv))
  .option("directories", {
    alias: "d",
    type: "array",
    description: "目标扫描目录",
    default: ["."],
  })
  .option("dry-run", {
    alias: "n",
    type: "boolean",
    description: "预览操作而不实际执行命令",
    default: false,
  })
  .option("concurrency", {
    alias: "c",
    type: "number",
    description: "最大并发操作数",
    default: 5,
  })
  .option("verbose", {
    alias: "v",
    type: "boolean",
    description: "启用详细日志",
    default: false,
  })
  .help()
  .alias("help", "h")
  .parse() as {
  directories: string[];
  dryRun: boolean;
  concurrency: number;
  verbose: boolean;
};

/**
 * 递归扫描目录，检测项目文件
 */
async function scanDirectories(
  directories: string[],
  visited = new Set<string>(),
): Promise<Project[]> {
  const projects: Project[] = [];

  for (const dir of directories) {
    // 检查是否为绝对路径
    const fullPath =
      dir.startsWith("\\") || /^[A-Za-z]:/.test(dir)
        ? dir
        : join(process.cwd(), dir);

    if (visited.has(fullPath)) {
      continue;
    }
    visited.add(fullPath);

    try {
      const entries = await readdir(fullPath, { withFileTypes: true });

      // 检测当前目录是否包含项目文件
      const project = await detectProject(fullPath, entries);
      if (project) {
        projects.push(project);
      }

      // 递归扫描子目录，排除node_modules
      const subdirectories = entries
        .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
        .map((entry) => join(fullPath, entry.name));

      const subProjects = await scanDirectories(subdirectories, visited);
      projects.push(...subProjects);
    } catch (error) {
      console.error(
        `❌ 扫描目录 ${fullPath} 失败: ${(error as Error).message}`,
      );
    }
  }

  return projects;
}

/**
 * 检测目录中的项目类型
 */
async function detectProject(
  dir: string,
  entries: any[],
): Promise<Project | null> {
  // 检测 Node.js 项目
  const hasPackageJson = entries.some((entry) => entry.name === "package.json");
  if (hasPackageJson) {
    return {
      path: dir,
      type: "node",
      file: join(dir, "package.json"),
    };
  }

  // 检测 .NET 项目
  const dotnetExtensions = [".csproj", ".vbproj", ".fsproj"];
  const dotnetProjectFile = entries.find((entry) =>
    dotnetExtensions.includes(extname(entry.name)),
  );

  if (dotnetProjectFile) {
    return {
      path: dir,
      type: "dotnet",
      file: join(dir, dotnetProjectFile.name),
    };
  }

  return null;
}

/**
 * 执行项目清理
 */
async function executeClean(
  project: Project,
  dryRun: boolean,
  verbose: boolean,
): Promise<{ success: boolean; message: string; error?: string }> {
  // 硬编码的清理文件列表
  const filesToClean = [
    "test-dist",
    "*.log",
    "bin",
    "dist",
    "node_modules",
    "package-lock.json",
    "pnpm-lock.yaml",
    "bun.lockb",
    "obj",
    "release",
    "build",
    "out",
    ".turbo",
    ".expo",
  ];

  let totalCleaned = 0;

  try {
    // 解析glob模式
    for (const pattern of filesToClean) {
      const matchedFiles = await glob(pattern, { cwd: project.path });
      for (const file of matchedFiles) {
        const filePath = join(project.path, file);

        if (dryRun) {
          console.log(`[DRY RUN] 将要删除: ${filePath}`);
        } else {
          try {
            await rm(filePath, { recursive: true, force: true });
            if (verbose) {
              console.log(`✅ 删除: ${file}`);
            }
            totalCleaned++;
          } catch (error: any) {
            console.error(`❌ 删除 ${file} 失败: ${error.message}`);
            return {
              success: false,
              message: `删除 ${file} 失败`,
              error: error.message,
            };
          }
        }
      }
    }

    return {
      success: true,
      message: `成功清理项目 ${project.path}，共清理 ${totalCleaned} 个文件/目录`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `执行清理失败: ${project.path}`,
      error: error.message,
    };
  }
}

/**
 * 主函数
 */
async function main() {
  const { directories, dryRun, concurrency, verbose } = argv;

  console.log(`🚀 开始清理过程...`);
  console.log(`📋 扫描目录: ${directories.join(", ")}`);
  console.log(`🔍 并发数: ${concurrency}`);
  console.log(`💧 模拟运行: ${dryRun}`);
  console.log(`📝 详细日志: ${verbose}\n`);

  // 扫描项目
  console.log(`🔎 正在扫描项目...`);
  const projects = await scanDirectories(directories);
  console.log(`✅ 找到 ${projects.length} 个项目:\n`);

  // 打印找到的项目
  projects.forEach((project) => {
    console.log(`- ${project.type.toUpperCase()}: ${project.path}`);
  });
  console.log();

  if (projects.length === 0) {
    console.log(`📭 未找到项目。退出。`);
    return;
  }

  // 处理项目
  console.log(`⚙️  正在清理项目...`);
  const results: ProcessResult[] = [];
  let processed = 0;

  // 创建并发控制队列
  async function processQueue() {
    while (projects.length > 0) {
      const project = projects.shift()!;
      processed++;

      console.log(
        `🔄 [${processed}/${projects.length + processed}] 清理 ${project.type.toUpperCase()} 项目: ${project.path}`,
      );

      const result = await executeClean(project, dryRun, verbose);
      results.push({
        project,
        success: result.success,
        message: result.message,
        error: result.error,
      });

      if (result.success) {
        console.log(`✅ ${result.message}`);
      } else {
        console.error(`❌ ${result.message}`);
        if (result.error) {
          console.error(`   错误详情: ${result.error}`);
        }
      }
      console.log();
    }
  }

  // 启动并发处理
  const workers = Array.from({ length: concurrency }, processQueue);
  await Promise.all(workers);

  // 生成最终报告
  console.log(`📊 清理完成 ${results.length} 个项目:`);
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`✅ 成功: ${successful}`);
  console.log(`❌ 失败: ${failed}`);

  if (failed > 0) {
    console.log(`\n❌ 失败的项目:`);
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(`- ${r.project.path}: ${r.message}`);
        if (r.error) {
          console.log(`  错误: ${r.error}`);
        }
      });
  }

  console.log(`\n🎉 清理过程已完成。`);
}

// CLI 入口
if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ 未处理的错误: ${error.message}`);
    process.exit(1);
  });
}

export default main;
