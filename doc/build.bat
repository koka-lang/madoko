REM call madoko -v --tex overview.mdk
node ../lib/cli.js --tex -v overview.mdk
pdflatex -halt-on-error overview
