<!--madoko
Title 	  	: Madoko Local
Author      : Daan Leijen
Heading Base: 2
-->
# Madoko Local

**Currently still in testing stage -- use with care.**

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

Simply run the `madoko-local` program inside the directory that you would
like to access. Everything in that directory, and all its sub-directories
will be accessible:
```
> madoko-local
listening on          : http://localhost
connecting securely to: https://www.madoko.net
serving files under   : C:\Users\dknuth\docs

access server at      : http://localhost?secret=OsuwK3HbMoI7
```
This starts a local server that only listens on the local host
and does not accept connections from outside. It also shows 
that it connects using secure https with the madoko website, and
which local directory is accessible.

Now open the browser and go to the listed url -- or you can use the
`--launch` option to have `madoko-local` open the browser at that url
directly. The 'secret' in the url is unique on each computer and used as
an extra level of security. 

The url will directly open up the standard Madoko website
and all features are usable as normal, including cooperation
with multiple authors through cloud storage like Dropbox.
However, in the `Open` dialog you can now also open files
from your local disk and edit them as usual. 

# Command line options

Usage:

``` { font-weight=bold }
> madoko-local [options] [mount-directory]
```

Arguments:

\/`[mount-directory`]
  : If not given on the command line the last specified
    directory is used; if this is the first run the current
    working directory is used. The server only provides
    access to files and subdirectories in this directory but
    not outside of it.

Options:

\/`-h` &ensp; `--help`
  : Show help on the command line options.
\/`--launch`
  : After starting the server, launch the default browser
    at the correct localhost address.
\/`--verbose`
  : Emit more tracing messages.
\/`--secret [secret]`
  : If no secret is provided, a new random secret is
    generated. Otherwise, the provided secret is used.
    A secret is usually stored in the configuration file
    such that you have a stable url for Madoko. Using the
    `--secret` flag you can regenerate the secret every
    once in a while.
\/`--homedir <dir>`
  : Specify the user home directory. In this directory
    `madoko-local` will create a `.madoko` directory
    that contains a log file and the local configuration
    file (`config.json`).    
\/`--origin <url>`
  : Instead of serving `https://www.madoko.net` use the
    specified `url`. Only specify trusted websites here
    since that website can obtain local disk access!    
\/`--port <n>`
  : Use the specified port to serve `madoko-local`. 
    This can be useful if you have other servers running that 
    already use port 80.

`madoko-local` stores the last generated secret and 
last used mount-directory in the local configuration
file at `$HOME/.madoko/config.json`. 

# Security

The server is designed with multiple security layers:

* The server only listens on the localhost itself and does
  not accept outside connections.
* The Javascript API only accepts messages from the embedded
  frame and specified origin (`https://www.madoko.net`).
* The above is already enough if using a secure browser that prevents
  cross-site requests, but as an extra security feature, the server is
  started with a particular secret and only accepts requests that match
  the secret.
* The server only gives access to files under the specified
  mount directory.

# Future extensions

In the future `madoko-local` will be extended to also allow running
your own local LaTeX installation.

[Madoko.net]: https://www.madoko.net  "Madoko"
[Node.js]: http://nodejs.org "Node.JS"