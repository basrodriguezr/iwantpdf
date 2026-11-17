@echo off
cd /d "%~dp0"

rem Si el entorno no existe o viene copiado de otro equipo (no arranca), se vuelve a crear.
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import flask, pymupdf" >nul 2>&1 || (
    echo El entorno de Python no es valido en este equipo. Se va a reinstalar...
    rmdir /s /q ".venv"
  )
)
if exist ".venv\Scripts\python.exe" goto run

rem Buscar un Python real (el "python" de la Microsoft Store es solo un acceso directo y no sirve).
set "PY="
py -3 -c "import sys" >nul 2>&1 && set "PY=py -3"
if not defined PY (
  python -c "import sys" >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo.
  echo  No hay Python instalado en este equipo.
  echo.
  echo  1. Descargalo desde https://www.python.org/downloads/
  echo  2. Al instalar, marca la casilla "Add python.exe to PATH"
  echo  3. Vuelve a abrir este archivo
  echo.
  pause
  exit /b 1
)

echo Preparando iwantpdf por primera vez, espera unos minutos ^(necesita internet^)...
%PY% -m venv .venv || (
  echo  No se pudo crear el entorno de Python.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt || (
  echo.
  echo  Fallo la instalacion de dependencias. Revisa la conexion a internet y vuelve a intentarlo.
  rmdir /s /q ".venv"
  pause
  exit /b 1
)

:run
".venv\Scripts\python.exe" -W ignore app.py %*
