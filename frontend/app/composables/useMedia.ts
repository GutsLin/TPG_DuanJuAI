/**
 * 统一媒体资源 URL(云存储 P1)。
 * - 空值 → ''
 * - http(s):// 或 // 开头的绝对 URL(OSS / CDN)→ 原样返回
 * - / 开头的路径 → 原样返回
 * - 其余相对路径(如 static/images/xx.png)→ 拼前导 '/'
 */
export function mediaUrl(u?: string | null): string {
  if (!u) return ''
  if (/^(https?:)?\/\//i.test(u)) return u
  if (u.startsWith('/')) return u
  return `/${u}`
}
