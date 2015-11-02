/* ---------------------------------------------------------------------------
  Copyright 2013 Microsoft Corporation.
 
  This is free software; you can redistribute it and/or modify it under the
  terms of the Apache License, Version 2.0. A copy of the License can be
  found in the file "license.txt" at the root of this distribution.
---------------------------------------------------------------------------*/

define(["../scripts/map","../scripts/promise","../scripts/util",
        'vs/base/common/winjs.base',
        'vs/editor/common/common',
        'vs/editor/common/core/range',
        'vs/editor/contrib/hover/browser/hoverOperation',
        'vs/editor/contrib/hover/browser/hoverWidgets'],
        function(Map,Promise,Util,WinJS,Constants,Range,HoverOperation,HoverWidgets) {

var Editor = Constants;

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
        setTimeout( function(ev) { Util.dispatchEvent(window,"resize"); }, 100 ); // somehow the initial popup causes the preview to overflow the width..
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
  },

  getResultWithLoadingMessage: function() {
    return this.getResult();
  },
});

var visibleHover = null;

function createHoverWidget(superClass) {
  return WinJS.Class.derive(superClass, function HoverWidget(widgetId,editor,customMenu) {
    superClass.call(this, widgetId, editor);
    this.superClass = superClass;
    this.id = widgetId;
    this.lastRange = null;
    this.menu = customMenu;
    this.computer = new ContentComputer(customMenu);
    this.hoverOperation = new HoverOperation.HoverOperation(
      this.computer,
      this.withResult.bind(this),
      null,
      this.withResult.bind(this)
    );
    this._domNode.addEventListener("click", function(ev) {
      if (this.menu && this.menu.onClick && this.isVisible()) this.menu.onClick(ev);
      this.hide();
    }.bind(this));
  }, {
    
    startShowingAt: function (element, range, text, info) {
      if (this.lastRange && this.lastRange.equalsRange(range)) {
        // We have to show the widget at the exact same range as before, so no work is needed
        return;
      }
      if (element && this.menu.triggerOn && !this.menu.triggerOn(element,range,text,info)) {
        return;
      }
      
      this.hoverOperation.cancel();
      this.hide();
      if (visibleHover) visibleHover.hide();
      
      this.lastRange = range;
      this.computer.setContext(element, range, text, info);
      this.hoverOperation.start();
      visibleHover = this;
    },

    /*
    onKeyDown: function(ev) {
      if (this.isVisible()) {
        this.menu.onKeyDown(ev);
      }
    },
    */

    isVisible: function() {
      return (this.lastRange != null);
    },
    
    hide: function () {
      if (!this.isVisible()) return; // not shown
      this.lastRange = null;
      if (this===visibleHover) visibleHover = null;
      if (this.hoverOperation) {
        this.hoverOperation.cancel();
      }
      this.superClass.prototype.hide.call(this);
    },
    
    withResult: function (content) {
      this._domNode.innerHTML = content;
      if (this._showAtLineNumber) {
        this.showAt( this.lastRange.startLineNumber );
      }
      else {
        this.showAt(this.lastRange.getStartPosition());
      }
    }
  });
}

var ContentWidget = createHoverWidget(HoverWidgets.ContentHoverWidget);
var GlyphWidget   = createHoverWidget(HoverWidgets.GlyphHoverWidget);

function addCustomHover(widgetId,ed,customMenu) {
  
  var editor = ed;
  var widget = (widgetId.indexOf("glyph") >= 0 ? new GlyphWidget(widgetId,editor,customMenu) : new ContentWidget(widgetId,editor,customMenu));
 
  function hide() {
    widget.hide();
  }

  function onKeyDown(ev) {
    if (widget.isVisible() && !ev.altKey) {
      // widget.onKeyDown(ev);
      hide();
    }
  }

  function onMouseDown(ev) {
    if (!ev.target) return
    if (!widget.isVisible()) return;
    var targetType = ev.target.type;
    if ((targetType !== Editor.MouseTargetType.CONTENT_WIDGET && targetType !== Editor.MouseTargetType.OVERLAY_WIDGET) || ev.target.detail !== widget.id) {
      hide();
      return;
    }
  }
 
  function onMouseMove(e) {    
    if (!e.target) return;
    var targetType = e.target.type;

    if ((targetType === Editor.MouseTargetType.CONTENT_WIDGET || targetType === Editor.MouseTargetType.OVERLAY_WIDGET) && e.target.detail === widget.id) {
      return;
    }
    
    if ((targetType === Editor.MouseTargetType.CONTENT_TEXT || targetType===Editor.MouseTargetType.GUTTER_GLYPH_MARGIN) && e.target.element != null) {
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
          if (info && info.lineNumber) {
            range = new Range.Range(info.lineNumber, info.startColumn, info.lineNumber, info.endColumn);
          }         
        });
      }

      if (range) {
        var text = editor.getModel().getValueInRange(range);
        widget.startShowingAt(e.target.element, range, text, info );
        return;
      }
    }
    //hide();
  }

  editor.addListener(Constants.EventType.MouseMove, onMouseMove);
  editor.addListener(Constants.EventType.MouseLeave, hide);
  editor.addListener(Constants.EventType.KeyDown, onKeyDown);
  editor.addListener(Constants.EventType.ModelChanged, hide);
  editor.addListener(Constants.EventType.MouseDown, onMouseDown);
  editor.addListener('scroll', hide);

  return widget;
}

return {
  create: addCustomHover,
}

});
