import { clipboard, nativeImage } from 'electron'

/** Copy a local image file onto the system clipboard (PNG/JPEG). */
export function copyImageFileToClipboard(filePath: string): boolean {
  if (!filePath) {
    return false
  }

  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) {
    return false
  }

  clipboard.writeImage(image)
  return true
}
