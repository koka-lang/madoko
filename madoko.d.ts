declare module 'madoko' {
  type Options = any;
  type Position = { path: string, line: number }
  type Label = {
      id: string,
      element: string,
      caption: string,
      position?: Position
  }
  type DocumentInfo = {
      lineMap: any,
      labels: Label[],
      context: any,
      log: string
  }

  //(md : string, stdout : string, needRerun : bool, options : options/options, files : string, filesRefer : string, filesWrite : string, labels : string, links : string, customs : string, entities : string) -> <(io :: E)> ()
  type Callback = 
     (md: string, 
      stdout: string, 
      needRerun: boolean, 
      options: Options, 
      files: string, 
      filesRefer: string, 
      filesWrite: string, 
      labels: string, 
      links: string,
      customs: string, 
      entities: string) => any;
 
  export function addImage(embeds : any, imageName : string, data : string): any;
  
  export function clearStorage(): any;

  export function readTextFile(fname : string): string;

  export function unlinkFile(fname : string): any;

  export function writeTextFile(fileName : string, content : string): any;

  export function initialOptions(args?: string): Options;

  export function markdown(
      inputName: string, 
      input: string, 
      outdir: string, 
      options: Options, 
      modes: string, 
      convertTex: boolean, 
      cont: Callback): any;
  
  export function analyze(
      inputName: string, 
      content: string, 
      outdir: string, 
      options: Options, 
      callback: (DocumentInfo) => any): any;
}
