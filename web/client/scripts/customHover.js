/*---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/map","../scripts/promise","../scripts/util",
        'vs/base/lib/winjs.base',
        'vs/editor/core/constants',
        'vs/editor/core/range',
        'vs/editor/editor',
        'vs/editor/contrib/hover/hoverOperation',
        'vs/editor/contrib/hover/hoverWidgets'],
        function(Map,Promise,Util,WinJS,Constants,Range,Editor,HoverOperation,ContentHoverWidget) {

  var ContentComputer = WinJS.Class.define(function ContentComputer(customMenu) { 
    this.menu = customMenu;
  }, { 
    setContext: function (range, text, tokenType) {
      this.menu.setContext(range,text,tokenType);
      this.content = "";
    },
    
    computeAsync: function () {
      return WinJS.Promise.timeout(1).then(function() {
        return this.menu.asyncGetContent();
      }.bind(this));
    },
    
    computeSync: function () {
      return this.menu.getContent();
    },
    
    onResult: function(r) {
      this.content = this.content + r;
    },
    
    getResult: function() {
      return this.content;
    }
  });

  var ContentWidget = WinJS.Class.derive(ContentHoverWidget.ContentHoverWidget, function ContentWidget(editor,customMenu) {
    ContentHoverWidget.ContentHoverWidget.call(this, 'custom.hover.widget.id', editor);
    this.lastRange = null;
    this.computer = new ContentComputer(customMenu);
    this.hoverOperation = new HoverOperation.HoverOperation(
      this.computer,
      this.withResult.bind(this),
      null,
      this.withResult.bind(this)
    );
  }, {
    
    startShowingAt: function (range, text, tokenType) {
      if (this.lastRange && this.lastRange.equalsRange(range)) {
        // We have to show the widget at the exact same range as before, so no work is needed
        return;
      }
      
      this.hoverOperation.cancel();
      this.hide();
      
      this.lastRange = range;
      this.computer.setContext(range, text, tokenType);
      this.hoverOperation.start();
    },
    
    hide: function () {
      this.lastRange = null;
      if (this.hoverOperation) {
        this.hoverOperation.cancel();
      }
      ContentHoverWidget.ContentHoverWidget.prototype.hide.call(this);
    },
    
    withResult: function (content) {
      this._domNode.innerHTML = content;
      this.showAt({
        lineNumber: this.lastRange.startLineNumber,
        column: this.lastRange.startColumn
      });
    }
  });

  var addCustomHover = (function() {
    
    var editor = null;
    var contentWidget = null;
    
    function hide() {
      contentWidget.hide();
    }
    
    function onMouseMove(e) {
      var targetType = e.target.type;
      
      if (targetType === Editor.MouseTargetType.CONTENT_WIDGET && e.target.detail === 'custom.hover.widget.id') {
        // mouse moved on top of content hover widget
        return;
      }
      
      if (targetType === Editor.MouseTargetType.CONTENT_TEXT) {
        // Extract current token under cursor
        var currentTokenInfo = null;
        editor.getModel().tokenIterator(e.target.position, function (it) {
          currentTokenInfo = it.next();
        });
        
        if(currentTokenInfo) {
          var showRange = new Range.Range(currentTokenInfo.lineNumber, currentTokenInfo.startColumn, currentTokenInfo.lineNumber, currentTokenInfo.endColumn);
        
          contentWidget.startShowingAt(showRange, editor.getModel().getValueInRange(showRange), currentTokenInfo.token.type);
        }
      } else {
        hide();
      }
    }
    
    function setup(ed,customMenu) {
      editor = ed;
      contentWidget = new ContentWidget(editor,customMenu);
      
      editor.addListener(Constants.EventType.MouseMove, onMouseMove);
      editor.addListener(Constants.EventType.MouseLeave, hide);
      editor.addListener(Constants.EventType.KeyDown, hide);
      editor.addListener(Constants.EventType.ModelChanged, hide);
      editor.addListener('scroll', hide);
    }
    
    return setup;
  })();

return {
  create: addCustomHover,
}

});
