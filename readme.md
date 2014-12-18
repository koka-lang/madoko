Title 	  	: Madoko
Author      : Daan Leijen
Heading Base: 2

# Madoko -- a Fast Scholarly Markdown Processor

Madoko is a fast javascript [Markdown] processor written in [Koka]
It started out as a demo program for the new, strongly typed, [Koka] language and
the name comes from "_Ma_\/rk\/_do_\/wn in _Ko_\/ka".

Madoko can both be run local as a command-line program, or as a full
online experience on [Madoko.net] with storage and collaboration through [dropbox] or [github].

## Using Madoko

The best experience is online at: <https://www.madoko.net>

Otherwise, you can run Madoko on the command line:

* Ensure you have [Node.js](http://nodejs.org) installed on your system.

* Open a command line window and run the Node package manager to install Madoko:

  `npm install madoko -g`

and you are done. Translating a markdown document is done simply as:

* `madoko -v mydoc.mdk`

which generates `mydoc.html`. The `-v` flag gives more verbose output.
To also generate a PDF file, use:

* `madoko --pdf -vv --odir=out mydoc`

where `--odir` puts all output files in the `out` directory. To generate
a PDF, you need to have LaTeX installed on your system, which is also
required for mathematics and bibliographies. We recommend the
full [TeXLive] LaTeX system as it is available for Windows, Linux and
MacOSX, and is used on the [Madoko.net] server as well.

[TexLive]:    https://www.tug.org/texlive
[MacTeX]:     http://tug.org/mactex/
[Madoko.net]: https://www.madoko.net

## Madoko philosophy

The main design goal of Madoko is to enable light-weight creation of 
high-quality scholarly and industrial documents for the web and print,
while maintaining John Gruber's Markdown philosophy of simplicity and focus on
plain text readability.

The popularity of Markdown is not accidental, and it is great for writing
prose: it is super simple and straightforward to create good looking HTML
documents. But for more serious use Markdown falls short in several areas,
and Madoko provides many essential additions for larger documents.

Besides HTML output, Madoko also generates high-quality PDF files through LaTeX. Even
though more Markdown implementations support this, there has been a lot of
effort in Madoko to make the LaTeX generation robust and customizable. This
makes it possible to write high-quality articles using just Madoko and get
both a high-quality print format (PDF) and a good looking HTML page.

For more information look at the [Madoko manual](http://research.microsoft.com/en-us/um/people/daan/madoko/doc/reference.html)

Have fun,
-- Daan

[Koka]:     http://koka.codeplex.com
[dropbox]:  http://dropbox.com
[github]:   http://github.com
[markdown]: http://daringfireball.net/projects/markdown/