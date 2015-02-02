/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/map","../scripts/promise","../scripts/util",
        "../scripts/madokoMode","vs/editor/modes/monarch/monarch",
        "vs/editor/core/range", "vs/editor/core/selection","vs/editor/core/command/replaceCommand","vs/base/network",
         "vs/platform/services","vs/editor/modes/modesExtensions", "vs/platform/platform","vs/editor/standalone/standaloneCodeEditor"],
        function(Map,Promise,Util,MadokoMode,Monarch,Range,Selection,ReplaceCommand,Url,Services,ModesExtensions,Platform,StandaloneCodeEditor) {


//---------------------------------------------------------------------------
// Disable symantic validation for javascript
//---------------------------------------------------------------------------
var modesRegistry = Platform.Registry.as(ModesExtensions.Extensions.EditorModes);
modesRegistry.configureMode('text/typescript', {
              validationSettings: {
                     "semanticValidation": false,
                     "syntaxValidation": true,
              }
       });

modesRegistry.configureMode('text/javascript', {
              validationSettings: {
                     "semanticValidation": false,
                     "syntaxValidation": true,
              }
       });

//---------------------------------------------------------------------------
// Register Madoko languages
//---------------------------------------------------------------------------

function createCustomMode(mode) {
  ModesExtensions.registerModeAsyncDescriptor(mode.name, [mode.name].concat(mode.mimeTypes), new Services.AsyncDescriptor('vs/editor/modes/monarch/monarch', 'DynamicMonarchMode', mode));
  return modesRegistry.getMode(mode.name);
}

var languages = [
  "bibtex","boogie","codehunt","cpp","csharp","dafny","haskell","html","java","koka","latex","python","ruby","smt","javascript",
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
    var originalModel = Monaco.Editor.createModel(original, "text/plain");
    var modifiedModel = Monaco.Editor.createModel(modified, "text/plain"); 
    var diffSupport   = modifiedModel.getMode().diffSupport;
    var diff = diffSupport.computeDiff( 
                  originalModel.getAssociatedResource(), modifiedModel.getAssociatedResource() );    
    return new Promise(diff); // wrap promise
  }).timeout(5000,new Error("Diff operation timed out"));
}



//---------------------------------------------------------------------------
// Enable saving of entire editor model
//---------------------------------------------------------------------------

var Model = (function() {
  function dehydrateAssociatedResource(model) {
    var r = model.getAssociatedResource().toExternal();
    if (r.indexOf('inMemory://') === 0) {
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
          if (md) return md;
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

