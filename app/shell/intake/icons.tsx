// The few Phosphor icons the intake screen uses, from the same package as the rest of the shell
// (@phosphor-icons/core, which every session has, React or Vue).
import check from '@phosphor-icons/core/assets/bold/check-bold.svg?raw'
import plus from '@phosphor-icons/core/assets/bold/plus-bold.svg?raw'
import x from '@phosphor-icons/core/assets/bold/x-bold.svg?raw'
import fileText from '@phosphor-icons/core/assets/regular/file-text.svg?raw'
import upload from '@phosphor-icons/core/assets/regular/upload-simple.svg?raw'
import sparkle from '@phosphor-icons/core/assets/regular/sparkle.svg?raw'
import sparkleFill from '@phosphor-icons/core/assets/fill/sparkle-fill.svg?raw'

const SVG = { check, plus, x, fileText, upload, sparkle, sparkleFill }
export type IconName = keyof typeof SVG

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return <span aria-hidden="true" className={`inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}
    dangerouslySetInnerHTML={{ __html: SVG[name].replace('<svg', `<svg width="${size}" height="${size}" fill="currentColor"`) }} />
}
