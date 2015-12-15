<!--meta
Title 	  	: Madoko Local
Author      : Daan Leijen
-->

# Madoko Local

This program provides local disk access to the [Madoko.net] environment.
This can be convenient if you do not want to use
standard cloud storage (like Dropbox) or are already using
a particular Git repository but still want to have the
rich editing experience provided by Madoko.net.

# Installation

Ensure you have [Node.js] installed on your system. When that
is done, you can use the 'node package manager' (`npm`) to install
the `madoko-local` program:
```
> npm install -g madoko-local
```
and that's it :-)

# Usage 

Simply run the `madoko-local` program with the directory that you would
like to access as an argument. Everything in that directory, and all its 
sub-directories will be accessible to Madoko. Here we run it with access
to the current directory:
```
> madoko-local -l .
listening on          : http://localhost
connecting securely to: https://www.madoko.net
serving files under   : C:\Users\dknuth\docs

access server at      : http://localhost#secret=OsuwK3HbMoI7
```
This starts a local server that only listens on the local host and does
not accept connections from outside. It also shows that it connects using
secure https with the Madoko website, and which local directory is
accessible within Madoko.

The `-l` flag will launch the browser and go to the listed url, i.e.
`http://localhost#secret=OsuwK3HbMoI7` in our example. The 'secret' in
the url is unique on each computer and used as an extra level of
security.

The url will directly open up the standard Madoko website and all
features are usable as normal, including cooperation with multiple
authors through cloud storage like Dropbox. However, in the `Open` dialog
you can now also open files from your local disk and edit them as usual.

** Note.** With Internet Explorer, you will be unable to log into remote
services (like Onedrive) under the localhost. If you use another browser
or just access the local disk this is no problem of course. Otherwise,
you must add `https://www.madoko.net` to both the trusted websites (under
the _security_ tab), and to the websites that can always add cookies
(under the _privacy_ tab).


# Command line options

Usage:

``` { font-weight=bold }
> madoko-local [options] [mount-directory]
```

Arguments:

* `mount-directory` 
  : The server only provides access to files and subdirectories under the 
    mount directory but not outside of it. If not given, the last specified 
    directory is used (which is stored in the local configuration file). 
    If this is the first run the current working directory is used.

Options:

* `-h`, `--help`
  : Show help on the command line     options.
* `-v`, `--version`
  : Show the current version of the program.
* `-l`, `--launch`
  : After starting the local server, launch the default browser
    at the correct localhost address.
* `-r`,`--run`,
  : Run Madoko locally to generate PDF's, render mathematics and
    to generate bibliographies. This means you are no longer dependent
    on the server to run LaTeX for you. This flag requires that you have
    installed both Madoko (`npm install -g madoko`) and
    LaTeX -- it is recommended to use  the latest [TexLive] _simple_ (or _full_) 
    installation which is also used on the Madoko server.       
* `--verbose[=<n>]`
  : Emit more tracing messages. 
    Set `n` to 2 to be the most verbose.
* `--secret[=secret]`
  : If no secret is provided, a new random secret is
    generated. Otherwise, the provided secret is used.
    A secret is usually stored in the configuration file
    such that you have a stable url for Madoko. Using the
    `--secret` flag you can generate a new secret every
    once in a while.
* `--homedir=<dir>`
  : Specify the user home directory. In this directory
    `madoko-local` will create a `.madoko` directory
    that contains a log file and the local configuration
    file (`config.json`).    
* `--origin=<url>`
  : Instead of serving `https://www.madoko.net` use the
    specified `url`. Only specify trusted websites here
    since that website can obtain local disk access!    
* `--port=<n>`
  : Use the specified port to serve `madoko-local`. 
    This can be useful if you have other servers running that 
    already use port 80.
* `--rundir=<dir>`,
  : The directory under which Madoko stores temporary files when
    running Madoko (if the `--run` flag is present). Defaults to the
    mount-directory.
* `--runcmd=<cmd>`,
  : The command to use when running Madoko locally. By default this
    is `madoko`. 
* `--runflags=<flags>`,
  : Extra flags to pass to the Madoko program when running locally.
    These flags are appended to the standard flags, namely:
    `-vv -mmath-embed:512 --odir=out --sandbox`. 

`madoko-local` stores the last generated secret and last used
mount-directory in the local configuration file at
`$HOME/.madoko/config.json`.

# Running LaTeX locally

When you pass the `--run` flag, the `madoko-local` program will not
only serve files, but also run the local Madoko installation to generate
PDF's, render mathematics, or generate the bibliography. It will store
files temporarily under the `<rundir>/.madoko` directory where it runs
Madoko with the `--sandbox` flag to restrict access to files under that
directory only. 

When running Madoko locally, you need to have installed both Madoko and LaTeX.
Madoko can be installed through the Node package manager as:
```
> npm install -g madoko
```
For LaTeX, the latest [TexLive] full installation is recommended since it
is also used on the Madoko server and it respects the `openin_any` and
`openout_any` settings which are needed to run LaTeX in a sandboxed mode
too.

# Security

The server is designed with multiple security layers:

* The server only listens on the localhost itself and does not accept
  outside connections. All files are only sent and received inside the
  localhost (and even the `madoko.net` server cannot connect directly to
  `madoko-local`).
* The JavaScript API only accepts messages from the embedded frame and
  specified origin (`https://www.madoko.net`).
* The above is already enough if using a secure browser that prevents
  cross-site scripting requests, but as an extra security layer, the
  server is started with a particular secret and only accepts requests
  that match the secret.
* The server only gives access to files and directories under the specified
  mount directory.
* When running Madoko locally, it runs it also in a sandbox restricting access
  to files and directories under a specific run directory.


[Madoko.net]: https://www.madoko.net  "Madoko"
[Node.js]: http://nodejs.org "Node.JS"
[TexLive]: https://www.tug.org/texlive "Tex Live"