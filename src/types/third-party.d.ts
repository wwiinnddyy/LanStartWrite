declare module 'leafer-ui' {
  export class Leafer {
    constructor(...args: any[])
    [key: string]: any
  }

  export class Line {
    constructor(...args: any[])
    [key: string]: any
  }

  export class Polygon {
    constructor(...args: any[])
    [key: string]: any
  }
}

declare module 'perfect-freehand' {
  export function getStroke(points: number[][], options?: Record<string, unknown>): number[][]
}

declare module 'pdfjs-dist/legacy/build/pdf.js' {
  const pdfjs: any
  export = pdfjs
}

declare module 'pdfjs-dist/legacy/build/pdf.worker.min.js?url' {
  const url: string
  export default url
}
