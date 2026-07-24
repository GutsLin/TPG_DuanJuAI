export const DEFAULT_IMAGE_SIZE = '1920x1080'

export const SUPPORTED_IMAGE_SIZES = [
  '1920x1080',
  '1080x1920',
  '2560x1440',
  '1440x2560',
] as const

const SUPPORTED_IMAGE_SIZE_SET = new Set<string>(SUPPORTED_IMAGE_SIZES)

/**
 * Validate and canonicalize provider image dimensions.
 * Image generation only supports fixed 1K/2K templates in 16:9 or 9:16.
 */
export function validateImageSize(size?: string | null): string {
  if (size != null && typeof size !== 'string') {
    throw new Error(`Invalid image size: expected one of ${SUPPORTED_IMAGE_SIZES.join(', ')}`)
  }

  const value = size == null || size.trim() === '' ? DEFAULT_IMAGE_SIZE : size.trim()
  if (!SUPPORTED_IMAGE_SIZE_SET.has(value)) {
    throw new Error(`Invalid image size: expected one of ${SUPPORTED_IMAGE_SIZES.join(', ')}`)
  }
  return value
}
