/**
 * 路径字符串工具（纯函数）。
 *
 * 渲染进程没有 Node 的 `path` 模块，这里按路径里出现的分隔符判断平台。
 * 只做字符串运算，不碰文件系统。
 */

/**
 * 判断路径使用的分隔符。
 * @param path 路径。
 * @returns '\\' 或 '/'。
 */
function sepOf(path: string): string {
  return path.includes('\\') ? '\\' : '/';
}

/**
 * 拼接目录与文件名。
 * @param dir 目录路径。
 * @param name 文件名。
 * @returns 完整路径。
 */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = sepOf(dir);
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/**
 * 取路径的父目录。
 * @param path 文件绝对路径。
 * @returns 父目录路径；无分隔符时为空串。
 */
export function dirnameOf(path: string): string {
  const sep = sepOf(path);
  const index = path.lastIndexOf(sep);
  return index < 0 ? '' : path.slice(0, index);
}

/**
 * 取路径最后一段（文件名或目录名）。
 * @param path 路径。
 * @returns 最后一段；末尾带分隔符时忽略它。
 */
export function basenameOf(path: string): string {
  const sep = sepOf(path);
  const trimmed = path.endsWith(sep) ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf(sep);
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

/**
 * 取文件所在目录的目录名（`{parent}` 变量用）。
 * @param path 文件绝对路径。
 * @returns 父目录名；取不到为空串。
 */
export function parentName(path: string): string {
  return basenameOf(dirnameOf(path));
}

/**
 * 把文件名拆成基名与扩展名。
 *
 * 按**最后一个点**拆分；`.gitignore` 这类以点开头的整体算基名（无扩展名），
 * 否则「去掉扩展名」会把整个文件名吃掉。
 * @param name 文件名（不含目录）。
 * @returns 基名与扩展名（扩展名不含点，无扩展名为空串）。
 */
export function splitName(name: string): { base: string; ext: string } {
  const index = name.lastIndexOf('.');
  if (index <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, index), ext: name.slice(index + 1) };
}

/**
 * 由基名与扩展名拼回文件名。
 * @param base 基名。
 * @param ext 扩展名（不含点，空串表示无扩展名）。
 * @returns 文件名。
 */
export function joinName(base: string, ext: string): string {
  return ext ? `${base}.${ext}` : base;
}
