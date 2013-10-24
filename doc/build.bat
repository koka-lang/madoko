REM call madoko -v --tex overview.md
node ../lib/cli.js --tex -v overview.md
pdflatex -halt-on-error overview
