declare module 'madoko' {
  type Options = any;
  type Position = { path: string, line: number }
  type Range = { path: string, from: number, to: number }
  type ReferenceInfo = {
      id: string,
      element: string,
      caption: string,
      position?: Position
  }
  type DocumentInfo = {
      labels: ReferenceInfo[],
      blocks: Block[],
      context: any,
      log: string
  }
  type Block = {
    kind: string,
    // the element id, empty if not present
    id: string,
    // the tag name, empty if not present
    name: string,
    // the child nodes
    content: Block[],
    // the element classes
    classes: string[],
    // the annotated attributes
    attributes: any,
    // the range (lines are 1-based and inclusive)
    range?: Range
  }

  export function analyze(
      inputName: string, 
      content: string,
      resolveIncludes: boolean, // perform includes?
      callback: (DocumentInfo) => any): any;
}
