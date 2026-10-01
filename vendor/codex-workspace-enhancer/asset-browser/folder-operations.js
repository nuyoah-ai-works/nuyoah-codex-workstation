import { promises as fs } from "node:fs";
import path from "node:path";

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;
const WINDOWS_INVALID_CHARACTER = /[<>:"/\\|?*\u0000-\u001f]/;

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function validateFolderName(value) {
  const name = String(value ?? "").trim().normalize("NFC");
  if (!name) throw new Error("请输入文件夹名称");
  if (name.length > 120) throw new Error("文件夹名称不能超过 120 个字符");
  if (name === "." || name === "..") throw new Error("文件夹名称无效");
  if (WINDOWS_INVALID_CHARACTER.test(name)) throw new Error("文件夹名称不能包含 \\ / : * ? \" < > |");
  if (/[. ]$/.test(name)) throw new Error("文件夹名称不能以空格或句点结尾");
  if (WINDOWS_RESERVED_NAME.test(name)) throw new Error("该名称是 Windows 保留名称，请换一个");
  return name;
}

export async function createProjectFolder({ projectPath, parentPath = "", name }) {
  const projectRoot = path.resolve(String(projectPath || ""));
  const folderName = validateFolderName(name);
  const requestedParent = String(parentPath || "");
  const parentAbsolute = path.resolve(projectRoot, requestedParent);
  if (!isWithin(projectRoot, parentAbsolute)) throw new Error("目标位置超出项目目录");

  const [projectStat, parentStat] = await Promise.all([
    fs.stat(projectRoot),
    fs.lstat(parentAbsolute),
  ]);
  if (!projectStat.isDirectory()) throw new Error("项目路径不是文件夹");
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error("目标层级不是可用文件夹");

  const [projectRealPath, parentRealPath] = await Promise.all([
    fs.realpath(projectRoot),
    fs.realpath(parentAbsolute),
  ]);
  if (!isWithin(projectRealPath, parentRealPath)) throw new Error("目标位置超出项目目录");

  const targetAbsolute = path.join(parentAbsolute, folderName);
  if (!isWithin(projectRoot, targetAbsolute)) throw new Error("目标位置超出项目目录");
  try {
    await fs.mkdir(targetAbsolute, { recursive: false });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`文件夹“${folderName}”已存在`);
    throw error;
  }

  const relativePath = path.relative(projectRoot, targetAbsolute);
  const parentRelativePath = path.relative(projectRoot, parentAbsolute);
  return {
    name: folderName,
    absolutePath: targetAbsolute,
    relativePath,
    parentRelativePath,
  };
}

export async function renameProjectFolder({ projectPath, folderPath, name }) {
  const projectRoot = path.resolve(String(projectPath || ""));
  const requestedPath = String(folderPath || "");
  const sourceAbsolute = path.resolve(projectRoot, requestedPath);
  const folderName = validateFolderName(name);
  if (sourceAbsolute === projectRoot) throw new Error("项目根目录不能改名");
  if (!isWithin(projectRoot, sourceAbsolute)) throw new Error("目标位置超出项目目录");

  const parentAbsolute = path.dirname(sourceAbsolute);
  const [projectStat, sourceStat, parentStat] = await Promise.all([
    fs.stat(projectRoot),
    fs.lstat(sourceAbsolute),
    fs.lstat(parentAbsolute),
  ]);
  if (!projectStat.isDirectory()) throw new Error("项目路径不是文件夹");
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error("只能修改普通文件夹的名称");
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error("目标层级不是可用文件夹");

  const [projectRealPath, sourceRealPath, parentRealPath] = await Promise.all([
    fs.realpath(projectRoot),
    fs.realpath(sourceAbsolute),
    fs.realpath(parentAbsolute),
  ]);
  if (!isWithin(projectRealPath, sourceRealPath) || !isWithin(projectRealPath, parentRealPath)) {
    throw new Error("目标位置超出项目目录");
  }

  const targetAbsolute = path.join(parentAbsolute, folderName);
  if (!isWithin(projectRoot, targetAbsolute)) throw new Error("目标位置超出项目目录");
  const currentName = path.basename(sourceAbsolute);
  if (currentName === folderName) {
    return {
      name: folderName,
      previousName: currentName,
      absolutePath: sourceAbsolute,
      previousRelativePath: path.relative(projectRoot, sourceAbsolute),
      relativePath: path.relative(projectRoot, sourceAbsolute),
      parentRelativePath: path.relative(projectRoot, parentAbsolute),
      unchanged: true,
    };
  }

  try {
    const targetRealPath = await fs.realpath(targetAbsolute);
    const comparableTarget = process.platform === "win32" ? targetRealPath.toLowerCase() : targetRealPath;
    const comparableSource = process.platform === "win32" ? sourceRealPath.toLowerCase() : sourceRealPath;
    if (comparableTarget !== comparableSource) throw new Error(`文件夹“${folderName}”已存在`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    await fs.rename(sourceAbsolute, targetAbsolute);
  } catch (error) {
    if (["EEXIST", "ENOTEMPTY"].includes(error?.code)) throw new Error(`文件夹“${folderName}”已存在`);
    if (error?.code === "ENOENT") throw new Error("要改名的文件夹已经不存在");
    throw error;
  }

  return {
    name: folderName,
    previousName: currentName,
    absolutePath: targetAbsolute,
    previousRelativePath: path.relative(projectRoot, sourceAbsolute),
    relativePath: path.relative(projectRoot, targetAbsolute),
    parentRelativePath: path.relative(projectRoot, parentAbsolute),
    unchanged: false,
  };
}
