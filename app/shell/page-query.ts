// A self-contained share's device frame reuses the downloaded document through
// srcdoc. Its URL stays about:srcdoc, so the boot script supplies the frame query.
// Ordinary pages and direct ?frame= URLs continue to use their own address.
const framedQuery = (window as Window & { __protoFrameQuery?: unknown }).__protoFrameQuery
export const pageQuery = location.href === 'about:srcdoc' && typeof framedQuery === 'string' ? framedQuery : location.search
