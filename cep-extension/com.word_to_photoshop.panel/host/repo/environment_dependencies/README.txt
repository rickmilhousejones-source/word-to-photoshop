Offline bundles for embedded Python (used by tools/bootstrap_embed_python.ps1).

Place these files in THIS folder (same directory as this README):

1) python-3.12.7-embed-amd64.zip
   Official Windows embeddable zip from:
   https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip

2) get-pip.py
   Download once from:
   https://bootstrap.pypa.io/get-pip.py

The installer copies this whole folder into the CEP extension under:
  host/repo/environment_dependencies/

Photoshop ScriptUI will install into:
  %APPDATA%\com.word_to_photoshop\python-embed-3.12\

No Python.org download is performed at install time if the zip is present.
