/* ---------------------------------------------------------------------------
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
    setContext: function (elem, range, text, info) {
      this.menu.setContext(elem, range,text,info);
      this.content = "";
      this.contentAsync = "";
    },

    _fullContent: function() {
      return this.contentAsync + this.content;
    },
    
    computeAsync: function () {
      return WinJS.Promise.timeout(1).then(function() {
        return this.menu.asyncGetContent().then( function( res ) {
          this.contentAsync = res;
          return;
        }.bind(this));
      }.bind(this));
    },
    
    computeSync: function () {
      this.content = this.menu.getContent();
    },
    
    onResult: function(r) {
    },
    
    getResult: function() {
      var className = this.menu.getClassName() || "";
      className = className.replace(/\./g," ");
      return "<div class='" + className + "'>" + this.contentAsync + this.content + "</div>";
    }
  });

  var ContentWidget = WinJS.Class.derive(ContentHoverWidget.ContentHoverWidget, function ContentWidget(editor,customMenu) {
    ContentHoverWidget.ContentHoverWidget.call(this, 'custom.hover.widget.id', editor);
    this.lastRange = null;
    this.menu = customMenu;
    this.menu.setWidget(this);
    this.computer = new ContentComputer(customMenu);
    this.hoverOperation = new HoverOperation.HoverOperation(
      this.computer,
      this.withResult.bind(this),
      null,
      this.withResult.bind(this)
    );
  }, {
    
    startShowingAt: function (element, range, text, info) {
      this.mouseOver = false;
      if (this.lastRange && this.lastRange.equalsRange(range)) {
        // We have to show the widget at the exact same range as before, so no work is needed
        return;
      }
      if (element && this.menu.triggerOn && !this.menu.triggerOn(element,range,text,info)) {
        return;
      }
      
      this.hoverOperation.cancel();
      this.hide();
      
      this.lastRange = range;
      this.computer.setContext(element, range, text, info);
      this.hoverOperation.start();
    },
    
    hide: function () {
      this.mouseOver = false;
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
        contentWidget.mouseOver = true;
        return;
      }


      
      if (targetType === Editor.MouseTargetType.CONTENT_TEXT && e.target.element != null) {
        // get range
        var range = null;
        var info  = null;

        // first look at decorations
        var decs = editor.getModel().getLineDecorations(e.target.position.lineNumber);
        decs.forEach( function(dec) {
          if (dec.range.containsPosition(e.target.position)) {
            if (range==null || range.containsRange(dec.range)) {
              range = dec.range;
              info = dec;
            }
          }
        });
        
        if (range==null) {
          editor.getModel().tokenIterator(e.target.position, function (it) {
            info = it.next();             
            range = new Range.Range(info.lineNumber, info.startColumn, info.lineNumber, info.endColumn);
          });
        }

        if (range) {
          var text = editor.getModel().getValueInRange(range);
          contentWidget.startShowingAt(e.target.element, range, text, info );
        }
      } else {
        if (contentWidget.mouseOver) {
          // hide();
        }
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

      return contentWidget;
    }
    
    return setup;
  })();

return {
  create: addCustomHover,
}

});
