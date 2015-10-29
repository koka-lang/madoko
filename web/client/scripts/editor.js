/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/
define(["../scripts/map","../scripts/promise","../scripts/util",
        "../scripts/madokoMode","vs/editor/common/modes/monarch/monarchDefinition",
        "vs/editor/common/core/range", "vs/editor/common/core/selection","vs/editor/common/commands/replaceCommand",
        "vs/base/common/network",
        "vs/platform/instantiation/common/descriptors","vs/editor/common/modes/modesRegistry", "vs/platform/platform", "vs/editor/diff",
        "vs/editor/common/modes/supports",
        "vs/editor/browser/standalone/standaloneCodeEditor",
        "vs/editor/browser/standalone/standaloneServices", 
        "vs/editor/common/modes/languageExtensionPoint"],
        function(Map,Promise,Util,MadokoMode,Monarch,Range,Selection,ReplaceCommand,Url,Descriptors,ModesExtensions,Platform,Diff,
                 Supports,StandaloneCodeEditor,StandaloneServices,LanguageExtensionPoint) {



//---------------------------------------------------------------------------
// Disable symantic validation for javascript
//---------------------------------------------------------------------------
var services = StandaloneServices.getOrCreateStaticServices();

// var modesRegistry = Platform.Registry.as(ModesExtensions.Extensions.EditorModes);
services.modeService.configureMode('text/typescript', {
              validationSettings: {
                     "semanticValidation": false,
                     "syntaxValidation": true,
              }});

services.modeService.configureMode('text/javascript', {
              validationSettings: {
                     "semanticValidation": false,
                     "syntaxValidation": true,
              }});

//---------------------------------------------------------------------------
// Register Madoko languages
//---------------------------------------------------------------------------

function createCustomMode(mode) {
  //ModesExtensions.registerModeAsyncDescriptor(mode.name, [mode.name].concat(mode.mimeTypes), new Descriptors.AsncDescriptor('vs/editor/common/modes/monarch/monarchDefinition', 'DynamicMonarchMode', mode));
  if (typeof mode.wordDefinition === "string") mode.wordDefinition = new RegExp(mode.wordDefinition);
  services.modeService.registerMonarchDefinition(mode.name,mode);
  LanguageExtensionPoint.LanguageExtensions._onLanguage( { pluginId: mode.name }, {
    id: mode.name,
    mimetypes: mode.mimeTypes,
    extensions: mode.fileExtensions,
  });
  //return modesRegistry.getMode(mode.name);
}

var languages = [
  "bibtex","boogie","codehunt","cpp","csharp","dafny","haskell",
  "java","koka","latex","python","ruby","smt",
  // "html","javascript",
];

Util.requestGET("styles/lang/madoko.json").then(function(madokoMode,req) {
  //madokoMode.name = "text/madoko";
  createCustomMode(madokoMode); 
  languages.forEach( function(lang) { 
    Util.requestGET("styles/lang/" + lang + ".json").then( function(mode) {
      createCustomMode(mode);
    });
  });
});



//---------------------------------------------------------------------------
// Editor commands
//---------------------------------------------------------------------------

var ReplaceCommandWithSelection = (function (_super) {
        Util.__extends(ReplaceCommandWithSelection, _super);
        function ReplaceCommandWithSelection(range, text) {
            _super.call(this, range, text);
        }
        ReplaceCommandWithSelection.prototype.computeCursorState = function (model, helper) {
            var inverseEditOperations = helper.getInverseEditOperations();
            var srcRange = inverseEditOperations[0].range;
            var rng = srcRange; //this._range;
            return new Selection.Selection(rng.startLineNumber, rng.startColumn, rng.endLineNumber, rng.endColumn);
        };
        return ReplaceCommandWithSelection;
    })(ReplaceCommand.ReplaceCommand);

function diff( original, modified ) {
  return Promise.do( function() {
    var olines = original.split("\n");
    var mlines = modified.split("\n");
    return new Diff.DiffComputer(olines,mlines,true,false).computeDiff();
    /*
    var originalModel = Monaco.Editor.createModel(original, "text/plain");
    var modifiedModel = Monaco.Editor.createModel(modified, "text/plain"); 
    var diffSupport   = modifiedModel.getMode().diffSupport;
    var diff = diffSupport.computeDiff( 
                  originalModel.getAssociatedResource(), modifiedModel.getAssociatedResource() );    
    return new Promise(diff); // wrap promise
    */
  }).timeout(5000,new Error("Diff operation timed out"));
}



//---------------------------------------------------------------------------
// Enable saving of entire editor model
//---------------------------------------------------------------------------

var Model = (function() {
  function dehydrateAssociatedResource(model) {
    var r = model.getAssociatedResource().toString();
    if (r.indexOf('inmemory://') === 0) {
      return null;
    }
    return r;
  }
  function hydrateAssociatedResource(v) {
    if (!v) {
      return null;
    } else {
      return new Url.URL(v);
    }
  }
  
  function dehydrateSelection(s) {
    return [s.selectionStartLineNumber, s.selectionStartColumn, s.positionLineNumber, s.positionColumn];
  }
  function hydrateSelection(v) {
    return new Selection.Selection(v[0], v[1], v[2], v[3]);
  }
  
  function dehydrateRange(r) {
    return [r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn];
  }
  function hydrateRange(v) {
    return new Range.Range(v[0], v[1], v[2], v[3]);
  }
  
  function dehydrateSingleEditOperation(editOp) {
    var r = dehydrateRange(editOp.range);
    r.push(editOp.text);
    return r;
  }
  function hydrateSingleEditOperation(v) {
    return {
      range: hydrateRange(v),
      text: v[4]
    };
  }
  
  function dehydrateEditOperation(editOp) {
    return editOp.operations.map(dehydrateSingleEditOperation);
  }
  function hydrateEditOperation(v) {
    return {
      operations: v.map(hydrateSingleEditOperation)
    };
  }
  
  function dehydrateStackElement(el) {
    if (!el) {
      return null;
    }
    return [
      el.beforeCursorState.map(dehydrateSelection),
      el.editOperations.map(dehydrateEditOperation),
      el.afterCursorState.map(dehydrateSelection),
    ];
  }
  function hydrateStackElement(v) {
    if (!v) {
      return null;
    }
    return {
      beforeCursorState: v[0].map(hydrateSelection),
      editOperations: v[1].map(hydrateEditOperation),
      afterCursorState: v[2].map(hydrateSelection)
    };
  }
  
  function dehydrateEditStack(model) {
    var s = model._commandManager;
    
    return [
      s.past.map(dehydrateStackElement),
      dehydrateStackElement(s.currentOpenStackElement),
      s.future.map(dehydrateStackElement),
    ];
  }
  function hydrateEditStack(model, v) {
    model._commandManager.past = v[0].map(hydrateStackElement);
    model._commandManager.currentOpenStackElement = hydrateStackElement(v[1]);
    model._commandManager.future = v[2].map(hydrateStackElement);
  }
  
  function dehydrateEditableRange(model) {
    if (model.hasEditableRange()) {
      return model.getEditableRange();
    }
    return null;
  }
  function hydrateEditableRange(model, v) {
    if (v) {
      model.setEditableRange(v);
    }
  }
  
  function dehydrateExtraProperties(model) {
    var r = {}, s = model.getProperties();
    for (var prop in s) {
      r[prop] = s[prop];
    }
    return r;
  }
  function hydrateExtraProperties(model, v) {
    for (var prop in v) {
      model.setProperty(prop, v[prop]);
    }
  }
  
  return {
    dehydrate: function(model) {
      return {
        _version: 1,
        associatedResource: dehydrateAssociatedResource(model),
        modeId: model.getMode().getId(),
        value: model.getValue(undefined, /*preserveBOM*/true),
        versionId: model.getVersionId(),
        editStack: dehydrateEditStack(model),
        editableRange: dehydrateEditableRange(model),
        extraProperties: dehydrateExtraProperties(model)
      };
    },
    
    hydrate: function(v) {
      if (v._version !== 1) {
        throw new Error('version check!');
      }
      
      var model = Monaco.Editor.createModel(v.value, v.modeId, hydrateAssociatedResource(v.associatedResource));
      model._versionId = v.versionId;
      hydrateEditStack(model, v.editStack);
      hydrateEditableRange(model, v.editableRange);
      hydrateExtraProperties(model, v.extraProperties);
      return model;
    }
  }
})();



//---------------------------------------------------------------------------
// Our editor remembers undo/redo and view state 
//---------------------------------------------------------------------------

var Editor = {
  ctor : function(editName) {
    var self = this;
    self.editName = editName || "";
    self.editState = new Map();
    self.suggester = null;
  },

  _suggesterSetCached : function(setter,arg) {
    var self = this;
    if (!arg) arg = self["_" + setter];
    if (self.suggester) {
      self.suggester[setter](arg);
      delete self["_" + setter];
    }
    else {
      self["_" + setter] = arg;
    }
  },

  setSuggestLabels : function(labels) {
    var self = this;
    self._suggesterSetCached("setLabels", labels);
  },

  setSuggestCitations : function(cites) {
    var self = this;
    self._suggesterSetCached("setCitations", cites);
  },

  setSuggestLinks : function(links) {
    var self = this;
    self._suggesterSetCached("setLinks", links);
  },

  setSuggestCustoms : function(customs) {
    var self = this;
    self._suggesterSetCached("setCustoms", customs);
  },

  setSuggestEntities : function(entities) {
    var self = this;
    self._suggesterSetCached("setEntities", entities);
  },

  clearEditState : function() {
    var self = this;
    self.editState = new Map();
    self.editName  = "";
  },

  saveEditState : function() {
    var self = this;
    var state = {
      modelState: Model.dehydrate(self.getModel()),
      viewState : self.saveViewState(),
    }
    self.editState.set(self.editName,state);
  },

  editFile : function( editName, content, options, mime) {
    var self = this;
    var mode = null;
    var initial = true;
    if (!mime && options) {
      if (typeof options.mode === "string") mime = options.mode;
      else if (options.mime) mime = options.mime;
      else mime = "text/plain";
    }
    if (mime==="text/markdown") mime = "text/madoko";
    
    if (editName !== self.editName) {
      // switch file..
      self.saveEditState();
      self.editName = editName;
      var state = self.editState.get(self.editName);
      if (state && state.modelState) {
        // restore previous state
        initial = false;
        self.setModel( Model.hydrate(state.modelState) );
        self.restoreViewState(state.viewState);
      }
      else {
        // do our best..
        if (state && state.position) self.setPosition(state.position,true,true);
        mode = Monaco.Editor.getOrCreateMode(mime).then( function(md) {
          if (md) {
            if (mime==="text/madoko" && !self.suggester) {
              self.suggester = new MadokoSuggester();
              self.setSuggestLabels();
              self.setSuggestCitations();
              self.setSuggestLinks();
              self.setSuggestEntities();
              self.setSuggestCustoms();
              md.suggestSupport = new Supports.SuggestSupport(md, self.suggester);              
              // md.tokenTypeClassificationSupport = new Supports.TokenTypeClassificationSupport({wordDefinition: /[\w\-]+/});
            }
            return md;
          }
          return Monaco.Editor.getOrCreateMode("text/plain");
        });
      }
    }

    // possibly update content
    var content0 = self.getValue();
    if (content0 !== content) {
      var pos = self.getPosition();
      if (initial) {
        // not loaded before
        self.model.setValue(content,mode);
        self.setPosition(pos,true,true);
      }
      else {
        self.model.setValue(content0,mode);
      
        if (pos.lineNumber !== 1 && !mode) {
          // set by a merge
          self.setPosition(pos,true,true);
        }      
        var rng = self.model.getFullModelRange();
        var command = new ReplaceCommand.ReplaceCommandWithoutChangingPosition(rng,content);      
        self.executeCommand("madoko",command);
      }
    }

    // update options
    if (options && options.mime) delete options.mime;
    if (options) self.updateOptions(options);            
  }
};

var MadokoSuggester = (function() {
  function MadokoSuggester() {
    var self = this;
    self.labels = [];
    self.cites = [];
    self.links = [];
  }

  MadokoSuggester.prototype.setLabels = function(_labels) {
    var self = this;
    self.labels = _labels || [];
  }

  MadokoSuggester.prototype.setCitations = function(_cites) {
    var self = this;
    self.cites = _cites || [];
  }

  MadokoSuggester.prototype.setLinks = function(_links) {
    var self = this;
    self.links = _links || [];
  }

  MadokoSuggester.prototype.setCustoms = function(_customs) {
    var self = this;
    self.customs = _customs || [];
  }

  MadokoSuggester.prototype.setEntities = function(_entities) {
    var self = this;
    self.entities = _entities || [];
  }

  MadokoSuggester.prototype.suggest = function(resource, position) {
    var self = this;
    var model = services.modelService.getModel(resource);
    var currentWord = model.getWordUntilPosition(position).word;
    var triggerChar = model.getLineContent(position.lineNumber).substr(position.column-currentWord.length-2,1);
  
    if (triggerChar === "@") return self._suggest(currentWord,"citation",self.cites);
    else if (triggerChar === "#") return self._suggest(currentWord,"label",self.labels);
    else if (triggerChar === "[")  return self._suggest(currentWord,"link",self.links);
    else if (triggerChar === "&")  return self._suggest(currentWord,"entity",self.entities);
    else if (triggerChar === "~")  return self._suggest(currentWord,"custom",self.customs);
    else return Promise.resolved([]);
  }

  MadokoSuggester.prototype._suggest = function(currentWord, type, items ) {
    var self = this;
    var suggestions = items.map( function(item) {
      return {
        type: type,
        label: item.label || item.name,
        codeSnippet: item.snippet || item.name,
        typeLabel: item.typeLabel || "", // item.description,
        documentationLabel: item.description || item.title || "",
      };      
    });
    return Promise.resolved( [{
        currentWord: currentWord,
        suggestions: suggestions,
      }]
    );
  }

  MadokoSuggester.prototype.triggerCharacters = ['#','@','[','&','~'];

  return MadokoSuggester;
})();

function enableSuggestions(mime,suggester) {
  var mode = services.modeService.getMode(mime);  
  var modeId = services.modeService.getModeId(mime);
  services.modeService.registerDeclarativeSuggestSupport(modeId,suggester);
}

function create( domElem, options ) {
  var base = Monaco.Editor.create(domElem,options);
  if (base) {
    Util.extend(base,Editor);
    base.ctor(options.editName);
  }
  return base;
}

// module
return {
  diff: diff,
  create: create,
  ReplaceCommandWithSelection: ReplaceCommandWithSelection,
};

});

