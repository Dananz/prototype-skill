// The Prototype mark for /me and the plain pages: five cubes, the picked one purple, optionally on its
// tile. Still and decorative; the one set of paths is landing/mark.tsx's.
import { LogoMark } from './landing/mark'

export function Logo({ tile = false, className = '' }: { tile?: boolean; className?: string }) {
  return <LogoMark animate="none" title="" tile={tile} className={className} />
}
