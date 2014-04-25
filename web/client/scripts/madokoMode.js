/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define([],function() {

var madokoMode = 
    {
      displayName: 'Madoko',
      name: 'mdk',
      mimeTypes: ['text/x-madoko'],
      fileExtensions: ['mdk'],
      editorOptions: { tabSize: 4, insertSpaces: true },
      ignoreCase: true,
    
      autoClosingPairs: [ ['"','"'],["{","}"],["[","]"],["(",")"] ],
      noindentBrackets: "~+",
      
      // escape codes 
      escapes:  /\\[^a-zA-Z0-9]/,  
    
      // escape codes for javascript/CSS strings
      jsescapes:  /\\(?:[btnfr\\"']|[0-7][0-7]?|[0-3][0-7]{2})/,
      
      metakey: /^(?:@(\w+) +)?((?:\w|([\.#~])(?=[\w\-]))[\w\-\.#~,]*( +?[\w\-]+){0,2}\\*?\*?) *[:]/,  
      
      // non matched elements
      empty: [
        'area', 'base', 'basefont', 'br', 'col', 'frame', 
        'hr', 'img', 'input', 'isindex', 'link', 'meta', 'param'
      ],
    
      tokenizer: {
        root: [
          // metadata
          //val rxMeta = regex(@"^"+ metaKey + @" *(.*(?:\n .*)*)(?:\n+(?=\n|" + metaKey + ")|$)")
          //val metaKey = @"(?:@(\w+) +)?((?:\w|([\.#~])(?=\S))[\w\-\.#~, ]*?\*?) *[:]"
          [/^(@metakey)/, { token: "namespace.metadata.key", next: "metadata" } ],
          
          // headers
          [/^(\s{0,3})(#+)((?:[^\\#\{]|@escapes)+)((?:#+)?)/, ['white','keyword.$1','keyword.$1','keyword.$1']],
          [/^\s{0,3}(=+|\-+)\s*$/, 'keyword.header'],      
          [/^\s{0,3}((\*[ ]?)+)\s*$/, 'keyword.header'],
          [/^\s{0,3}(~+)\s*(?:begin\s+(\w+)\s*|end\s+(\w+)\s*|(\w+)\s*)?(?=(?:\{[^}]+\}\s*)?$)/, {
            cases: {
              "$2": { token: 'keyword.header.custom.$2', bracket: "@open" },
              "$3": { token: 'keyword.header.custom.$3', bracket: "@close" },
              "$4~(equation|texraw)": { token: 'keyword.header.custom.$1', bracket: "@open", next: "@latexblock" },
              "$4": { token: 'keyword.header.custom.$1', bracket: "@open" },
              "@default": { token: 'keyword.header.custom.$1', bracket: "@close" }
            }}],      
          // code & quote     
          [/^\s{0,3}>+/, 'string.quote' ],  
          [/^(\t|[ ]{4})\S.*$/, { token: 'namespace.code', next: '@codeblock' } ], // code line
          //[/^\s*~+\s*$/, { token: 'namespace.code', bracket: '@open', next: '@codeblock' }],
          
          // github style code blocks
          [/^\s*(```+)\s*(?:([^\s\{]+)\s*)?(?:\{[^}]+\}\s*)?$/, { cases: {
            //"$2==javascript": { token: 'namespace.code', bracket: '@open', next: '@codeblockgh.$1.javascript', nextEmbedded: 'text/javascript' },
            //"$2==json": { token: 'namespace.code', bracket: '@open', next: '@codeblockgh.$1.json', nextEmbedded: 'application/json' },
            //"$2~\\w+/.*": { token: 'namespace.code', bracket: '@open', next: '@codeblockgh.$1.$2', nextEmbedded: '$2' },
            //"$2": { token: 'namespace.code', bracket: '@open', next: '@codeblockgh.$1.x-$2', nextEmbedded: 'text/x-$2' },
            "@default": { token: 'keyword.header.codeblock', bracket: '@open', next: '@codeblockgh.$1' }
          }}],
          // [/^\s*```+\s*((?:\w|[\/\-])+)\s*$/, { token: 'namespace.code', bracket: '@open', next: '@codeblockgh', nextEmbedded: '$1' }],
          
          // list
          [/^\s([\*\-+:]|\d\.)/, 'string.list'],
          
          // markup within lines
          { include: '@linecontent' },
        ],
        
        metadata: [
          [/^(@metakey)/, { token: "@rematch", next: "@pop" } ],
          [/^(?!\s\s\s)/, { token: "@rematch", next: "@pop" }],
          [/.+/, "string.escape" ]
        ],
        
        
        latexblock: [
          [/\s*\{[^\}]*\}/, 'string.escape' ],
          [/./, { token: "@rematch", switchTo: "latexblockcontent.$S2" } ]      
        ],
        
        latexblockcontent: [
          [/^\s*~+\s*$/, { cases: {
            "$1==$S2": { token: 'keyword.header.custom.latex', bracket: '@close', next: '@pop' },
            "@default": "code.latex" 
          }}],
          [/\\[a-zA-Z]+|\\.?/, "code.keyword.latex" ],
          [/[^\\]+/, 'code.latex' ],      
        ],
        
        codeblock: [      
          [/^(\t|[ ]{4}).*$/, 'namespace.code' ], // code line
          [/./, { token: "@rematch", next: "@pop"} ]
        ],
    
        // github style code blocks
        codeblockgh: [      
          [/(```+)\s*$/, { cases: {
            "$1==$S2": { cases: {
              "$S3": { token: '@rematch', bracket: '@close', switchTo: '@codeblockghend', nextEmbedded: '@pop' },
              "@default": { token: '@rematch', bracket: '@close', switchTo: '@codeblockghend' }
            }},
            "@default": "namespace.code" 
          }} ],
          [/[^`]*$/, 'namespace.code' ],
        ],
        
        codeblockghend: [
          [/\s*```+/, { token: 'keyword.header.codeblock', bracket: '@close', next: '@pop' } ],
          [/./, '@rematch', '@pop'], 
        ],
        
        linecontent: [      
          // [/\s(?=<(\w+)[^>]*>)/, {token: 'html', next: 'html.$1', nextEmbedded: 'text/html' } ],
          // [/<(\w+)[^>]*>/, {token: '@rematch', next: 'html.$1', nextEmbedded: 'text/html' } ],
          
          // escapes
          [/&\w+;/, 'string.escape'],      
          [/@escapes/, 'escape' ],
          
          // various markup
          [/\b__([^\\_]|@escapes|_(?!_))+__\b/, 'strong'],
          [/\*\*([^\\*]|@escapes|\*(?!\*))+\*\*/, 'strong'],
          [/\b_[^_]+_\b/, 'emphasis'],
          [/\*([^\\*]|@escapes)+\*/, 'emphasis'],
          [/`([^`])+`/, 'namespace.code'],
          [/(\$)((?:[^\\$]|\\.)+)(\$)/, ['','namespace.code.latex',''] ],
          [/<<|>>/, ''],
          
          // links
          [/\{[^}]+\}/, 'string.escape'],
          [/(!?\[)((?:[^\]\\]|@escapes)+)(\]\([^\)]+\))/, ['string.link', '', 'string.link' ]],
          [/(!?\[)((?:[^\]\\]|@escapes)+)(\])/, 'string.link'],          
          
          // or html
          { include: 'html' },
        ],
        
        html: [
          // html tags
          [/<(\w+)\/>/, 'tag.tag-$1' ],
          [/<(\w+)(?=\s*[\/>]|\s+\w)/,  {cases: { '@empty':   { token: 'tag.tag-$1', next: '@tag.$1' },
                                '@default': { token: 'tag.tag-$1', bracket: '@open', next: '@tag.$1' } }}],
          [/<\/(\w+)\s*>/,  { token: 'tag.tag-$1', bracket: '@close', next: '@pop' } ],
          
          // whitespace      
          { include: '@whitespace' },      
        ],
        
        
        // whitespace and (html style) comments
        whitespace: [
          [/[ ]{2}$/, 'invalid'],
          [/[ \t\r\n]+/, 'white'],
          [/<!--/, 'comment', '@comment']
        ],
        
        comment: [
          [/[^<\-]+/, 'comment.content' ],
          [/-->/, 'comment', '@pop' ],
          [/<!--/, 'comment.content.invalid'],
          [/[<\-]/, 'comment.content' ]
        ],
            
        // Almost full HTML tag matching, complete with embedded scripts & styles        
        tag: [
          [/[ \t\r\n]+/, 'white' ],
          [/(type)(\s*=\s*)(")([^"]+)(")/, [ 'attribute.name', 'delimiter', 'attribute.value',
                                             {token: 'attribute.value', switchTo: '@tag.$S2.$4' },
                                             'attribute.value'] ], 
          [/(type)(\s*=\s*)(')([^']+)(')/, [ 'attribute.name', 'delimiter', 'attribute.value',
                                             {token: 'attribute.value', switchTo: '@tag.$S2.$4' },
                                             'attribute.value'] ], 
          [/(\w+)(\s*=\s*)("[^"]*"|'[^']*')/, ['attribute.name','delimiter','attribute.value']],
          [/\w+/, 'attribute.name' ],      
          [/\/>/, 'tag.tag-$S2', '@pop'],
          [/>/, { cases: { '$S2==style' : { token: 'tag.tag-$S2', switchTo: '@embedded.$S2', nextEmbedded: 'text/css'},
                           '$S2==script': { cases: { '$S3'     : { token: 'tag.tag-$S2', switchTo: '@embedded.$S2', nextEmbedded: '$S3' },
                                                     '@default': { token: 'tag.tag-$S2', switchTo: '@embedded.$S2', nextEmbedded: 'text/javascript' } } },
                           '@default'   : { token: 'tag.tag-$S2', switchTo: 'html' } } }],
        ],
        
        embedded: [
          [/[^"'<]+/, ''],
          [/<\/(\w+)\s*>/, { cases: { '$1==$S2' : { token: '@rematch', switchTo: '@html', nextEmbedded: '@pop' },
                                      '@default': '' } }],
          [/"([^"\\]|\\.)*$/, 'string.invalid' ],  // non-teminated string
          [/'([^'\\]|\\.)*$/, 'string.invalid' ],  // non-teminated string
          [/"/, 'string', '@string."' ],
          [/'/, 'string', '@string.\'' ],
          [/</, '']
        ],
        
        // scan embedded strings in javascript or css
        string: [
          [/[^\\"']+/, 'string'], // "'
          [/@jsescapes/, 'string.escape'],
          [/\\./,      'string.escape.invalid'],
          [/["']/,     { cases: { '$#==$S2' : { token: 'string', next: '@pop' },
                                  '@default': 'string' }} ]
        ],
    
      },
    };
  
  return {
    mode: madokoMode
  };
});