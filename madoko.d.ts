declare module 'madoko' {
  type MadokoOptions = any;

  //(md : string, stdout : string, needRerun : bool, options : options/options, files : string, filesRefer : string, filesWrite : string, labels : string, links : string, customs : string, entities : string) -> <(io :: E)> ()
  type MadokoCallback = 
     (md: string, 
      stdout: string, 
      needRerun: boolean, 
      options: MadokoOptions, 
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

  export function initialOptions(args?: string): MadokoOptions;

  export function markdown(
      inputName: string, 
      input: string, 
      outdir: string, 
      options: MadokoOptions, 
      modes: string, 
      convertTex: boolean, 
      cont: MadokoCallback): any;
}
