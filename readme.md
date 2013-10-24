Title 		: Madoko
Heading Base: 2

# Madoko

Madoko is a fast javascript [Markdown] processor written in [Koka]
It started out as a demo program for the new [Koka] language and
the name comes from "_Ma_\/rk\/_do_\/wn in _Ko_\/ka".

Madoko is a javascript program that runs on [Node.js]. It is about 30% faster
then [Marked] (one of the fastest Javascript markdown implementations), and
about 8 times faster than [Showdown] and [Markdown.js]. Madoko is also
available as a .NET executable on windows.

For more information look in the `doc` directory.
Have fun,
-- Daan

[Koka]: 		http://koka.codeplex.com
[Markdown]: 	http://daringfireball.net/projects/markdown/syntax
[Markdown.js]: 	https://github.com/evilstreak/markdown-js
[Showdown]: 	https://github.com/coreyti/showdown
[Marked]: 		https://github.com/chjj/marked
[Node.js]:		http://nodejs.org	

[Documentation]: http://madoko.codeplex.com

## Madoko philosophy

Even though Madoko is fast, the main design goal is not efficiency: I wanted to
extend Markdown to make it suitable to create high-quality documents for the
web and print, while maintaining John Gruber's Markdown philosophy of
simplicity and focus on plain text readability.

The popularity of Markdown is not accidental, and it is great for writing
prose: it is super simple and straightforward to create good looking HTML
documents. But for more serious use Markdown falls short in several areas and
many extended implementations have arisen in the recent years. Madoko
addresses many of the weaknesses of Markdown. In particular, it helps you
with those things that a computer can well do for you: like numbering, document
references, generating table of contents, footnotes, bibliographies, and
document styling.

Besides HTML output, Madoko can also generate high-quality PDF files through
LaTeX. Even though more Markdown implementations support this, there has been
a lot of effort in Madoko to make the LaTeX generation very good and
customizable. This makes it possible to write high-quality articles
using just Madoko and get both a high-quality print format (PDF) and a good
looking HTML page. 

## Performance

Aug 5th, 2013 (on an ASUS zenbook with an i5):
```
>jake bench
> node test --bench --gfm
benchmarking (best of 10 times 50 repetitions on 57 files)
 madoko (bench, gfm)        : completed in 766ms.
 marked (bench, gfm)        : completed in 1157ms.
Could not bench robotskirt.
 showdown (reuse converter) : completed in 6469ms.
 showdown (new converter)   : completed in 7110ms.
 markdown.js                : completed in 6859ms.

relative to madoko:
 madoko (bench, gfm)        : 1
 marked (bench, gfm)        : 1.51x slower
 showdown (reuse converter) : 8.45x slower
 showdown (new converter)   : 9.28x slower
 markdown.js                : 8.95x slower
```

