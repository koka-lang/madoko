function initTOC() {
  var toc = document.getElementById('toc');    
  if (toc == null) return;
  var tocToggle = document.getElementById('toc-toggle');
  var tocHeader = document.getElementById('toc-header') || tocToggle;
  	
  function showToc() {
    toc.style.display = 'block';
    if (tocToggle){
      tocToggle.innerHTML = '&#x25BC;'
      tocToggle.style.fontSize = 'medium'
    }
  }
  function hideToc() {
    toc.style.display = 'none';
    if (tocToggle) {
      tocToggle.innerHTML = '&#x25B6;';    
      tocToggle.style.fontSize = 'medium';
    }
  }
  function switchToc() {
    (toc.style.display != 'none' ? hideToc() : showToc());
  }

  if (tocHeader) {
  	tocHeader.onclick = switchToc;
  	tocHeader.style.cursor = "pointer";
  }
  hideToc()
}

window.onload = function() { initTOC(); };
