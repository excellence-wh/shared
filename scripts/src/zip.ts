#!/usr/bin/env bun
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { createWriteStream } from "node:fs";
import archiver from "archiver";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

type ProjectType = "node" | "dotnet" | "unknown";

type CompressionFormat = "zip" | "tar" | "tgz";

interface Project {
  path: string;
  type: ProjectType;
  file: string;
}

interface CompressionConfig {
  files?: string[];
  exclude?: string[];
  format?: CompressionFormat;
  output?: string;
}

interface ProcessResult {
  project: Project;
  success: boolean;
  message: string;
  outputFile?: string;
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
  .option("format", {
    alias: "f",
    type: "string",
    choices: ["zip", "tar", "tgz"],
    description: "压缩格式",
    default: "zip",
  })
  .option("output", {
    alias: "o",
    type: "string",
    description: "输出文件名模板",
    default: "{project}-{timestamp}.{format}",
  })
  .option("config", {
    alias: "conf",
    type: "string",
    description: "自定义配置文件路径",
  })
  .help()
  .alias("help", "h")
  .parse() as {
  directories: string[];
  dryRun: boolean;
  concurrency: number;
  verbose: boolean;
  format: CompressionFormat;
  output: string;
  config?: string;
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
 * 读取项目的压缩配置
 */
async function readCompressionConfig(
  project: Project,
  defaultFormat: CompressionFormat,
): Promise<CompressionConfig> {
  try {
    if (project.type === "node") {
      const packageJsonContent = await readFile(project.file, "utf8");
      const packageJson = JSON.parse(packageJsonContent);

      // 默认配置
      const defaultConfig: CompressionConfig = {
        files: ["dist", "build", "out"],
        exclude: ["node_modules", "*.log", ".git"],
        format: defaultFormat,
        output: "{project}-{timestamp}.{format}",
      };

      // 合并项目配置
      return { ...defaultConfig, ...packageJson.zip };
    } else if (project.type === "dotnet") {
      // .NET 项目默认配置
      return {
        files: ["bin/Release", "bin/Debug", "publish"],
        exclude: ["obj", "node_modules", "*.log", ".git"],
        format: defaultFormat,
        output: "{project}-{timestamp}.{format}",
      };
    }
  } catch (error) {
    console.error(`❌ 读取项目配置失败: ${(error as Error).message}`);
  }

  // 默认配置
  return {
    files: ["dist", "build", "out", "bin", "publish"],
    exclude: ["node_modules", "*.log", ".git"],
    format: defaultFormat,
    output: "{project}-{timestamp}.{format}",
  };
}

/**
 * 生成输出文件名
 */
function generateOutputFilename(
  project: Project,
  format: CompressionFormat,
  template: string,
): string {
  const projectName = basename(project.path);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  return template
    .replace("{project}", projectName)
    .replace("{timestamp}", timestamp)
    .replace("{format}", format);
}

/**
 * 检查路径是否应该被排除
 */
function shouldExclude(path: string, excludePatterns: string[]): boolean {
  const pathName = basename(path);
  return excludePatterns.some((pattern) => {
    if (pattern.startsWith("*") && pattern.endsWith("*")) {
      // 包含匹配
      return pathName.includes(pattern.slice(1, -1));
    } else if (pattern.startsWith("*")) {
      // 后缀匹配
      return pathName.endsWith(pattern.slice(1));
    } else if (pattern.endsWith("*")) {
      // 前缀匹配
      return pathName.startsWith(pattern.slice(0, -1));
    }
    // 精确匹配
    return pathName === pattern;
  });
}

/**
 * 执行项目压缩
 */
async function executeZip(
  project: Project,
  options: typeof argv,
): Promise<{
  success: boolean;
  message: string;
  outputFile?: string;
  error?: string;
}> {
  const { dryRun, verbose, format, output } = options;

  try {
    // 读取压缩配置
    const config = await readCompressionConfig(project, format);
    const compressionFormat = config.format || format;

    // 生成输出文件名
    const outputFilename = generateOutputFilename(
      project,
      compressionFormat,
      config.output || output,
    );
    const outputPath = join(project.path, outputFilename);

    if (dryRun) {
      return {
        success: true,
        message: `[DRY RUN] 将要压缩项目 ${project.path} 到 ${outputFilename}`,
        outputFile: outputFilename,
      };
    }

    // 检查是否有要压缩的文件
    const filesToCompress: string[] = [];
    const excludePatterns = config.exclude || [];

    for (const pattern of config.files || []) {
      const fullPath = join(project.path, pattern);
      try {
        const fileStat = await stat(fullPath);
        if (fileStat.isDirectory() || fileStat.isFile()) {
          if (!shouldExclude(fullPath, excludePatterns)) {
            filesToCompress.push(pattern);
          }
        }
      } catch (error) {
        // 文件不存在，跳过
        if (verbose) {
          console.log(`📝 文件 ${pattern} 不存在，跳过`);
        }
      }
    }

    if (filesToCompress.length === 0) {
      return {
        success: false,
        message: `项目 ${project.path} 中没有找到要压缩的文件`,
      };
    }

    // 创建压缩流，处理tgz格式
    const archiverFormat =
      compressionFormat === "tgz" ? "tar" : compressionFormat;
    const archive = archiver(archiverFormat, {
      gzip: compressionFormat === "tgz",
      zlib: { level: 9 }, // 最高压缩级别
    });

    const outputStream = createWriteStream(outputPath);

    // 监听事件
    archive.on("warning", (err) => {
      if (err.code === "ENOENT") {
        console.warn(`⚠️  ${err.message}`);
      } else {
        throw err;
      }
    });

    archive.on("error", (err) => {
      throw err;
    });

    // 管道输出
    archive.pipe(outputStream);

    // 添加文件到压缩包
    for (const filePattern of filesToCompress) {
      const fullPath = join(project.path, filePattern);
      const statInfo = await stat(fullPath);

      if (statInfo.isDirectory()) {
        archive.directory(fullPath, basename(filePattern));
      } else {
        archive.file(fullPath, { name: basename(filePattern) });
      }
    }

    // 完成压缩
    await archive.finalize();

    return {
      success: true,
      message: `成功压缩项目 ${project.path} 到 ${outputFilename}`,
      outputFile: outputFilename,
    };
  } catch (error) {
    return {
      success: false,
      message: `压缩项目 ${project.path} 失败`,
      error: (error as Error).message,
    };
  }
}

/**
 * 主函数
 */
async function main() {
  const { directories, dryRun, concurrency, verbose, format, output } = argv;

  console.log(`🚀 开始压缩过程...`);
  console.log(`📋 扫描目录: ${directories.join(", ")}`);
  console.log(`🔍 并发数: ${concurrency}`);
  console.log(`💧 模拟运行: ${dryRun}`);
  console.log(`📝 详细日志: ${verbose}`);
  console.log(`🗜️  压缩格式: ${format}`);
  console.log(`📦 输出模板: ${output}\n`);

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
  console.log(`⚙️  正在压缩项目...`);
  const results: ProcessResult[] = [];
  let processed = 0;

  // 创建并发控制队列
  async function processQueue() {
    while (projects.length > 0) {
      const project = projects.shift()!;
      processed++;

      console.log(
        `🔄 [${processed}/${projects.length + processed}] 压缩 ${project.type.toUpperCase()} 项目: ${project.path}`,
      );

      const result = await executeZip(project, argv);
      results.push({
        project,
        success: result.success,
        message: result.message,
        outputFile: result.outputFile,
        error: result.error,
      });

      if (result.success) {
        console.log(`✅ ${result.message}`);
        if (result.outputFile) {
          console.log(`📦 输出文件: ${result.outputFile}`);
        }
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
  console.log(`📊 压缩完成 ${results.length} 个项目:`);
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`✅ 成功: ${successful}`);
  console.log(`❌ 失败: ${failed}`);

  if (successful > 0) {
    console.log(`\n📦 成功压缩的文件:`);
    results
      .filter((r) => r.success && r.outputFile)
      .forEach((r) => {
        console.log(`- ${r.project.path}/${r.outputFile}`);
      });
  }

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

  console.log(`\n🎉 压缩过程已完成。`);
}

// CLI 入口
if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ 未处理的错误: ${error.message}`);
    process.exit(1);
  });
}

export default main;
